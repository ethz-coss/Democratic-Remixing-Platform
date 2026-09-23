<script lang="ts">
	import {
		Map as MapIcon,
		Zap,
		GitBranch,
		Maximize,
		Minimize,
		EyeOff,
		Plus,
		ChevronDown,
		ChevronUp,
		Lightbulb,
		TrendingUp,
		ListChecks,
		Users,
		List,
		Pen
	} from '@lucide/svelte';
	import * as T from '$lib/utils/terminology';
	import * as m from '$lib/paraglide/messages.js';
	import { enhance, deserialize } from '$app/forms';
	import { localizePath } from '$lib/utils/i18n-path';
	import { page } from '$app/state';
	import { onMount, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { createPocketBase } from '$lib/pb';
	const pb = createPocketBase();
	import { goto, invalidate, replaceState } from '$app/navigation';
	import VoteControls from '$lib/components/VoteControls.svelte';
	import WysiwygMarkdownEditor from '$lib/components/WysiwygMarkdownEditor.svelte';
	import StaticLineageGraph from '$lib/components/StaticLineageGraph.svelte';
	import { editorState } from '$lib/editor.svelte';
	import { feedViewState, getFilterState } from '$lib/feedView.svelte';
	import CompareButton from '$lib/components/CompareButton.svelte';
	import { isRemixingEnabled } from '$lib/utils/phase';
	import FilterBar from '$lib/components/FilterBar.svelte';
	import ProposalCard from '$lib/components/ProposalCard.svelte';
	import IdeaPickerModal from '$lib/components/IdeaPickerModal.svelte';
	import { filterProposals, sortProposals } from '$lib/services/feed-filter';
	import { computeLocalNeighborhood } from '$lib/services/local-neighborhood';
	import { logAction } from '$lib/services/telemetry';
	import { voteState } from '$lib/stores/voteState.svelte';

	let { data, form } = $props();

	// Mark as seen on load
	let trackedProposalId = '';
	$effect(() => {
		if (data.user && data.proposal && data.proposal.id !== trackedProposalId) {
			trackedProposalId = data.proposal.id;

			// Fire and forget
			fetch(`/api/remix/proposals/${data.proposal.id}/view`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId: data.user.id }),
				keepalive: true
			}).catch((e) => console.error('Failed to track view', e));

			logAction('proposal_view', { question: data.question.id, target_id: data.proposal.id });

			if (!feedViewState.optimisticSeen.includes(data.proposal.id)) {
				feedViewState.optimisticSeen.push(data.proposal.id);
			}
			// Note: We do NOT call invalidate('app:proposals') here.
			// SvelteKit clears page.state on shallow route invalidation,
			// which would cause the proposal modal to instantly close.
			// The optimistic tracker above is enough to update the feed UX.
		}
	});

	$effect(() => {
		const searchStr = page.url.search; // Force tracking on URL search string
		const searchParams = new URLSearchParams(searchStr);
		const compareId = searchParams.get('compare');
		const action = searchParams.get('action');

		if (!data.proposal) return;

		// 1. Legacy compareId support
		if (compareId) {
			const target =
				data.proposals?.find((p: App.ProposalRecord) => p.id === compareId) || data.compareProposal;

			if (target) {
				const currentProposal = data.proposal;
				editorState.openSourceComparison(target as any, [currentProposal]);
				goto(localizePath(`/questions/${questionId}/proposals/compare`), { replaceState: true });
			} else {
				console.error('Failed to load compare proposal: not found locally or on server.');
			}
			return;
		}

		// 2. New generic action=compare support (compares to all ancestors)
		if (action === 'compare') {
			const currentProposal = data.proposal;
			const parentProps = currentProposal.parent_proposals
				.map((pid: string) => data.proposals?.find((s: App.ProposalRecord) => s.id === pid))
				.filter(Boolean) as App.ProposalRecord[];

			if (parentProps.length > 0) {
				editorState.openSourceComparison(currentProposal, parentProps);
				goto(localizePath(`/questions/${questionId}/proposals/compare`), { replaceState: true });
			}
		}
	});

	// The proposal detail data comes from the page loader
	// Layout data (all proposals, edges) is available via data (merged by SvelteKit)
	const sol = $derived(data.proposal);
	const questionId = $derived(data.question.id);

	// ── Parent proposals (from layout's proposals list) ──────────────
	const allProposals: App.ProposalRecord[] = $derived(data.proposals ?? []);

	// ── Focus Quorum & Entry Bar ─────────────────────────────────────
	const focusQuorum = $derived(data.question?.focus_quorum ?? 0);
	const focusEntryBar = $derived.by(() => {
		const inFocus = allProposals.filter((s) => s.in_focus).map((s) => s.subscription_count ?? 0);
		if (inFocus.length === 0) return focusQuorum;
		if (inFocus.length < 10) return focusQuorum;
		return Math.max(focusQuorum, Math.min(...inFocus));
	});
	const parentProposals = $derived(
		sol.parent_proposals
			.map((pid: string) => allProposals.find((s: App.ProposalRecord) => s.id === pid))
			.filter((s: App.ProposalRecord | undefined): s is App.ProposalRecord => Boolean(s))
	);

	// ── Child proposals (direct branches/iterations) ─────────────────
	const childProposals = $derived(allProposals.filter((s) => s.parent_proposals.includes(sol.id)));

	// ── 1-hop neighborhood for mini-DAG ──────────────────────────────
	const neighborhood = $derived(computeLocalNeighborhood(sol.id, allProposals));
	const neighborhoodProposals = $derived(neighborhood.nodes);

	// ── 2. Graph/List Toggle & Related Proposals ─────────────────────
	let relatedView = $state<'graph' | 'list'>('graph');

	const relatedProposals = $derived(neighborhoodProposals.filter((p) => p.id !== sol.id));

	function getRelationLabel(p: App.ProposalRecord): {
		text: string;
		labelColor?: string;
		labelName?: string;
	} {
		const type = neighborhood.nodeTypes.get(p.id);
		if (type === 'source') return { text: m.relation_source() };
		if (type === 'iteration') return { text: m.relation_iteration() };
		if (type === 'earlier') return { text: m.relation_earlier_source() };
		if (type === 'further') return { text: m.relation_further_iteration() };
		if (type === 'topic-peer') {
			// Find shared label
			const focusLabels = sol.labels ?? [];
			const pLabels = p.labels ?? [];
			let sharedLabelId = focusLabels.find((l) => pLabels.includes(l));
			if (!sharedLabelId) sharedLabelId = sol.primary_label; // Fallback

			const sharedLabel = data.labels?.find((l: any) => l.id === sharedLabelId);
			if (sharedLabel) {
				return {
					text: m.relation_in_topic({ label: sharedLabel.short_name }),
					labelColor: sharedLabel.color,
					labelName: sharedLabel.short_name
				};
			}
			return { text: m.relation_fallback() };
		}
		return { text: m.relation_fallback() };
	}

	let relatedOnlySupported = $state(false);
	let relatedOnlyAuthored = $state(false);
	let relatedOnlyInFocus = $state(false);
	let relatedOnlyChampions = $state(false);
	let relatedOnlyCombinations = $state(false);
	let relatedOnlyImprovements = $state(false);
	let relatedOnlyUnseen = $state(false);
	let relatedSearchQuery = $state('');
	let relatedSelectedLabelId = $state<string | null>(null);

	// Use feedViewState.sortModeByContext['related'] and filters, but only apply to relatedProposals
	const filteredSortedRelatedProposals = $derived.by(() => {
		// Use feedViewState.sortModeByContext['related'] and filters, but only apply to relatedProposals
		const opts = {
			onlySupported: relatedOnlySupported,
			onlyAuthored: relatedOnlyAuthored,
			onlyInFocus: relatedOnlyInFocus,
			onlyChampions: relatedOnlyChampions,
			onlyCombinations: relatedOnlyCombinations,
			onlyImprovements: relatedOnlyImprovements,
			onlyUnseen: relatedOnlyUnseen,
			onlyHidden: getFilterState('related').feedTab === 'hidden',
			userVotes: data.userProposalVotes ?? {},
			userId: data.user?.id,
			championIds: feedViewState.championIds,
			searchQuery: relatedSearchQuery,
			selectedLabelId: relatedSelectedLabelId,
			seenProposalIds: new Set(data.seenProposalIds ?? []),
			userHiddenProposalIds: new Set([
				...(data.userHiddenProposalIds ?? []),
				...feedViewState.optimisticHidden
			])
		};

		const filtered = filterProposals(relatedProposals, new Set(), opts);
		return sortProposals(
			filtered,
			feedViewState.sortModeByContext['related'],
			opts,
			feedViewState.sortDirectionByContext['related']
		);
	});

	// ── Lineage graph toggle + desktop detection ─────────────────────
	let showLineageGraph = $state(false);
	let isFullscreen = $state(false);
	let isDesktop = $state(browser ? window.matchMedia('(min-width: 769px)').matches : false);

	onMount(() => {
		if (!browser) return;
		const mql = window.matchMedia('(min-width: 769px)');
		isDesktop = mql.matches;
		const handler = (e: MediaQueryListEvent) => {
			isDesktop = e.matches;
		};
		mql.addEventListener('change', handler);
		return () => mql.removeEventListener('change', handler);
	});

	// Get primary label details for the chip
	$effect(() => {
		if (data.labels?.length && sol.primary_label) {
			const found = data.labels.find((l: any) => l.id === sol.primary_label);
			if (!found)
				console.warn('[labels] primary_label not found in data.labels', sol.primary_label);
		}
	});
	const primaryLabel = $derived(
		sol.primary_label ? data.labels?.find((l: any) => l.id === sol.primary_label) : null
	);

	let isLabelsExpanded = $state(false);

	// Compute all label IDs for the detail page chip bar (primary_label + labels, deduplicated)
	const allSolLabelIds = $derived(
		Array.from(new Set([...(sol.primary_label ? [sol.primary_label] : []), ...(sol.labels || [])]))
	);

	// Grouping removed as per plan.

	// ── Vote state ────────────────────────────────────────────
	// `subscriptionCount` is kept as local state so the cluster standings
	// display ("Needs X more votes") can update after a vote.
	// VoteControls is fully self-contained and manages its own UI state.
	let currentProposalId = $state(untrack(() => data.proposal?.id));
	let subscriptionCount = $state(untrack(() => data.proposal?.subscription_count ?? 0));

	$effect(() => {
		if (sol?.id && sol.id !== currentProposalId) {
			currentProposalId = sol.id;
			subscriptionCount = sol.subscription_count ?? 0;
		}
	});

	// ── Comment state ────────────────────────────────────────────────
	let commentContent = $state('');

	let isComposing = $state(false);

	let showIdeaPicker = $state(false);

	async function handleHide() {
		let wasAlreadyHidden = feedViewState.optimisticHidden.includes(sol.id);
		if (!wasAlreadyHidden) {
			feedViewState.optimisticHidden.push(sol.id);
		}
		const fd = new FormData();
		fd.append('proposalId', sol.id);
		try {
			const res = await fetch(localizePath(`/questions/${questionId}/proposals`) + '?/hide', {
				method: 'POST',
				body: fd,
				headers: { 'x-sveltekit-action': 'true' }
			});
			const result = deserialize(await res.text());
			if (result.type === 'failure' || result.type === 'error') {
				throw new Error('Hide action failed');
			}
			await invalidate('app:proposals');
			goto(localizePath(`/questions/${questionId}/proposals/ideas`));
		} catch (err) {
			// Rollback on failure
			if (!wasAlreadyHidden) {
				feedViewState.optimisticHidden = feedViewState.optimisticHidden.filter(
					(id) => id !== sol.id
				);
			}
			console.error('Failed to hide proposal', err);
		}
	}

	// ── Inline Edit State ────────────────────────────────────────────
	let isEditing = $state(false);
	let editTitle = $state('');
	let editContent = $state('');
	let editRationale = $state('');
	let isSubmitting = $state(false);
	let submitError = $state('');

	const improveIntents = $derived([
		m.intent_fix_logic(),
		m.intent_restructure_clarity(),
		m.intent_add_context(),
		m.intent_new_direction(),
		m.intent_add_assumption(),
		m.intent_critique_assumption()
	]);

	function applyIntent(intent: string) {
		if (editRationale.length > 0 && !editRationale.endsWith(' ')) {
			editRationale += ', ';
		}
		editRationale += intent;
	}

	async function handleInlineSubmit(e: Event) {
		e.preventDefault();
		if (
			!editTitle.trim() ||
			!editContent.trim() ||
			!editRationale.trim() ||
			isSubmitting ||
			!data.user
		)
			return;
		isSubmitting = true;
		submitError = '';

		const formData = new FormData();
		formData.append('title', editTitle.trim());
		formData.append('content', editContent);
		formData.append('reason_for_change', editRationale);
		formData.append('parent_ids', sol.id);
		formData.append('base_parent', sol.id);

		try {
			const res = await fetch(localizePath(`/questions/${questionId}/proposals/editor`), {
				method: 'POST',
				body: formData,
				headers: {
					'x-sveltekit-action': 'true'
				}
			});

			let newProposalId: string | null = null;
			try {
				const text = await res.text();
				const { deserialize } = await import('$app/forms');
				const result = deserialize(text);

				if (result.type === 'success') {
					newProposalId = (result.data?.id as string) ?? null;
				} else if (result.type === 'failure') {
					submitError = (result.data?.message as string) || 'Failed to publish proposal.';
					isSubmitting = false;
					return;
				} else if (result.type === 'error') {
					submitError = 'An error occurred. Please try again.';
					isSubmitting = false;
					return;
				}
			} catch {
				submitError = 'Network error. Please try again.';
				isSubmitting = false;
				return;
			}

			isEditing = false;
			isSubmitting = false;

			// CRITICAL: Must invalidate the layout data manually since we used a custom fetch.
			// Without this, the new proposal won't appear in the feed if the realtime connection is dropped.
			// Do this BEFORE goto so that SvelteKit's preloadData fetches the fresh data instead of stale cache,
			// and so we don't wipe the history state of the newly pushed shallow route.
			await invalidate('app:proposals');

			if (newProposalId) {
				await goto(localizePath(`/questions/${questionId}/proposals/${newProposalId}`));
			}
		} catch (err) {
			console.error('Submission error', err);
			submitError = 'Network error. Please try again.';
			isSubmitting = false;
		}
	}

	// ── Time formatting ──────────────────────────────────────────────
	function timeAgo(dateStr: string): string {
		if (!dateStr) return '';
		const diff = Date.now() - Date.parse(dateStr);
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}
</script>

{#snippet provenance()}
	<!-- ══ G. Origin & Evolution ══ -->
	<div class="provenance-bar">
		{#if parentProposals.length === 0}
			<p class="provenance-origin" style="margin-bottom: 1rem;">
				<GitBranch size={14} class="inline-icon" style="margin-right:4px;" /> Original idea
			</p>
		{:else}
			<div
				class="sources-section"
				style="display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem;"
			>
				<div style="display: flex; align-items: center; gap: 0.4rem;">
					<GitBranch size={16} style="color: var(--primary);" />
					<h3 style="margin: 0; font-size: 0.95rem; font-weight: 700; color: var(--color-text);">
						{parentProposals.length === 1 ? 'Source Idea' : 'Source Ideas'}
					</h3>
				</div>

				<!-- 1. Source Idea Cards (Compact) -->
				<div class="sources-list" style="display: flex; flex-direction: column; gap: 0.4rem;">
					{#each parentProposals as parent (parent.id)}
						<ProposalCard
							proposal={parent}
							variant="compact"
							isSeen={true}
							interactive={true}
							canVote={!!data.user}
							clusterTitle={data.labels?.find((l) => l.id === parent.primary_label)?.short_name}
							clusterColor={data.labels?.find((l) => l.id === parent.primary_label)?.color}
							activeLabels={Array.from(
								new Set([
									...(parent.primary_label ? [parent.primary_label] : []),
									...(parent.labels || [])
								])
							)
								.map((id) => data.labels?.find((l) => l.id === id))
								.filter((l): l is App.LabelRecord => Boolean(l))
								.map((l) => ({ id: l.id, short_name: l.short_name, color: l.color }))}
							userVote={data.userProposalVotes?.[parent.id] ?? 0}
							subscriptionCount={parent.subscription_count}
							isAuthored={parent.author === data.user?.id}
							relationLabel="Source"
							hideCompare={true}
						/>
					{/each}
				</div>

				<!-- 2. Reason for Change (Compact) -->
				{#if sol.reason_for_change}
					<div
						style="background: var(--color-surface-50); padding: 0.5rem 0.75rem; border: 1px solid var(--color-border); border-left: 3px solid var(--primary); border-radius: 6px;"
					>
						<strong
							style="display: block; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-secondary); margin-bottom: 0.15rem;"
						>
							Reason for change
						</strong>
						<div
							style="font-size: 0.88rem; line-height: 1.35; color: var(--color-text); white-space: pre-wrap;"
						>
							{sol.reason_for_change}
						</div>
					</div>
				{/if}

				<!-- 3. Compare View Button (Compact) -->
				<button
					class="action-btn"
					style="width: 100%; justify-content: center; min-height: var(--touch-min, 38px); padding: 0.35rem 0.75rem; font-size: 0.85rem; font-weight: 600;"
					onclick={() => {
						editorState.openSourceComparison(sol, parentProposals);
						goto(localizePath(`/questions/${questionId}/proposals/compare`));
					}}
				>
					<T.ICON_COMPARE size={14} class="inline-icon" />
					{parentProposals.length === 1 ? m.compare_to_source() : m.compare_to_sources()}
				</button>
			</div>
		{/if}

		<div class="lineage-graph-container">
			<div
				style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;"
			>
				<h4 class="section-label" style="margin: 0;">{m.proposal_detail_related_ideas()}</h4>

				{#if !isDesktop}
					<div class="view-toggle">
						<button
							class="view-toggle-btn"
							class:active={relatedView === 'graph'}
							onclick={() => (relatedView = 'graph')}
						>
							<MapIcon size={14} />
							{m.proposal_detail_map_view()}
						</button>
						<button
							class="view-toggle-btn"
							class:active={relatedView === 'list'}
							onclick={() => (relatedView = 'list')}
						>
							<List size={14} />
							{m.proposal_detail_list_view()}
						</button>
					</div>
				{/if}
			</div>

			{#if !isDesktop && relatedView === 'graph'}
				<StaticLineageGraph
					focusedNodeId={sol.id}
					{allProposals}
					{neighborhoodProposals}
					nodeTypes={neighborhood.nodeTypes}
					hiddenSiblingCount={neighborhood.hiddenSiblingCount}
					labels={data.labels ?? []}
					question={data.question}
					questionId={data.question.id}
					hiddenProposalIds={new Set([
						...(data.userHiddenProposalIds ?? []),
						...feedViewState.optimisticHidden
					])}
					userVotes={voteState.userVotes}
				/>
			{:else}
				<div class="related-list-view">
					<FilterBar
						context="related"
						labels={data.labels ?? []}
						bind:sortMode={feedViewState.sortModeByContext['related']}
						bind:sortDirection={feedViewState.sortDirectionByContext['related']}
						bind:onlySupported={relatedOnlySupported}
						bind:onlyAuthored={relatedOnlyAuthored}
						bind:onlyInFocus={relatedOnlyInFocus}
						bind:onlyChampions={relatedOnlyChampions}
						bind:onlyCombinations={relatedOnlyCombinations}
						bind:onlyImprovements={relatedOnlyImprovements}
						bind:onlyUnseen={relatedOnlyUnseen}
						bind:searchQuery={relatedSearchQuery}
						bind:selectedLabelId={relatedSelectedLabelId}
					/>
					{#if filteredSortedRelatedProposals.length === 0}
						<div
							class="empty-state"
							style="padding: 2rem; text-align: center; color: var(--color-text-secondary); background: var(--color-surface-50); border-radius: 8px;"
						>
							{m.no_related_ideas_filtered()}
						</div>
					{:else}
						<div
							class="proposals-list"
							style="display: flex; flex-direction: column; gap: 0.75rem; margin-top: 1rem;"
						>
							{#each filteredSortedRelatedProposals as proposal (proposal.id)}
								{@const relInfo = getRelationLabel(proposal)}
								<ProposalCard
									{proposal}
									variant="standard"
									isSeen={true}
									interactive={true}
									canVote={!!data.user}
									clusterTitle={data.labels?.find((l) => l.id === proposal.primary_label)
										?.short_name}
									clusterColor={data.labels?.find((l) => l.id === proposal.primary_label)?.color}
									activeLabels={Array.from(
										new Set([
											...(proposal.primary_label ? [proposal.primary_label] : []),
											...(proposal.labels || [])
										])
									)
										.map((id) => data.labels?.find((l) => l.id === id))
										.filter((l): l is App.LabelRecord => Boolean(l))
										.map((l) => ({ id: l.id, short_name: l.short_name, color: l.color }))}
									userVote={data.userProposalVotes?.[proposal.id] ?? 0}
									subscriptionCount={proposal.subscription_count}
									isAuthored={proposal.author === data.user?.id}
									relationLabel={relInfo.text}
									relationLabelColor={relInfo.labelColor}
								/>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/snippet}

{#key sol.id}
	{@const labelRecord = data.labels?.find((l) => l.id === sol.primary_label)}
	<div class="detail-page">
		<div class="desktop-layout">
			<div class="detail-view">
				<!-- ══ A. Context & Lineage Header ══ -->
				<header class="detail-header">
					{#if !isEditing}
						<div
							class="title-with-label"
							style="display: flex; flex-direction: column; gap: 0.25rem;"
						>
							<h1
								class="proposal-title"
								style="margin:0 0 0.2rem 0; font-size:1.25rem; font-weight:800;"
							>
								{sol.title}
							</h1>
						</div>
					{/if}
					<p class="author-line">
						{#if sol.author_name}
							{m.by_author()}<strong>{sol.author_name}</strong> &middot;
						{/if}
						<span class="time-ago">{timeAgo(sol.created)}</span>
					</p>
					{#if allSolLabelIds.length > 0}
						<div class="labels-interactive-container">
							<div class="labels-scrollable-bar" class:expanded={isLabelsExpanded}>
								{#each allSolLabelIds.sort( (a, b) => (a === sol.primary_label ? -1 : b === sol.primary_label ? 1 : 0) ) as labelId}
									{@const l = data.labels?.find((lbl) => lbl.id === labelId)}
									{#if l}
										{#if isLabelsExpanded}
											{@const labelProposals = allProposals.filter((p) => p.labels?.includes(l.id))}
											{@const count = labelProposals.length}
											{@const highestVotes =
												labelProposals.length > 0
													? Math.max(...labelProposals.map((p) => p.subscription_count || 0))
													: 0}
											{@const isInFocus = labelProposals.some((p) => p.in_focus)}
											{@const uniqueAuthors = new Set(labelProposals.map((p) => p.author)).size}
											<div class="label-stat-card" style="border-left: 4px solid {l.color}">
												<div class="stat-card-header">
													<strong style="color: {l.color};">{l.short_name}</strong>
												</div>
												<div class="stat-card-grid">
													<div class="stat-item">
														<Lightbulb size={14} class="stat-icon" style="color: {l.color};" />
														<span class="stat-value">{count}</span>
														<span class="stat-tooltip">{m.stat_total_ideas()}</span>
													</div>
													<div class="stat-item">
														<TrendingUp size={14} class="stat-icon" style="color: {l.color};" />
														<span class="stat-value">{highestVotes}</span>
														<span class="stat-tooltip">{m.stat_top_votes()}</span>
													</div>
													<div class="stat-item">
														<ListChecks size={14} class="stat-icon" style="color: {l.color};" />
														<span class="stat-value"
															>{isInFocus ? m.common_yes() : m.common_no()}</span
														>
														<span class="stat-tooltip">{m.badge_in_focus()}</span>
													</div>
													<div class="stat-item">
														<Users size={14} class="stat-icon" style="color: {l.color};" />
														<span class="stat-value">{uniqueAuthors}</span>
														<span class="stat-tooltip">{m.stat_contributors()}</span>
													</div>
												</div>
											</div>
										{:else}
											<span
												class="label-chip"
												style="background-color: {l.color}{l.id === sol.primary_label
													? '33'
													: '1A'}; color: {l.color}; opacity: {l.id === sol.primary_label
													? '1'
													: '0.8'};"
											>
												{l.short_name}
											</span>
										{/if}
									{/if}
								{/each}
							</div>
							<button
								class="labels-toggle-btn"
								onclick={() => (isLabelsExpanded = !isLabelsExpanded)}
								aria-label="Toggle labels"
							>
								{#if isLabelsExpanded}
									<ChevronUp size={16} />
								{:else}
									<ChevronDown size={16} />
								{/if}
							</button>
						</div>
					{/if}
				</header>

				<!-- ══ B. Core Content ══ -->
				<div class="core-content">
					{#if isEditing}
						<form onsubmit={handleInlineSubmit} class="inline-edit-form">
							<div class="title-row">
								<input
									type="text"
									class="inline-edit-title-input"
									bind:value={editTitle}
									placeholder="Proposal Title"
									required
								/>
							</div>
							<div class="proposal-body">
								<WysiwygMarkdownEditor
									bind:html={editContent}
									editable={true}
									emptyText="No content"
								/>
							</div>
							<div class="rationale-section">
								<div class="rationale-header">
									<label for="editRationale">Reason for change</label>
									<div class="intent-chips">
										{#each improveIntents as intent}
											<button type="button" class="intent-chip" onclick={() => applyIntent(intent)}>
												{intent}
											</button>
										{/each}
									</div>
								</div>
								<textarea
									id="editRationale"
									class="inline-edit-rationale-input"
									bind:value={editRationale}
									placeholder="Explain what you changed and why..."
									rows="3"
									required
								></textarea>
							</div>

							{#if submitError}
								<p class="form-error">{submitError}</p>
							{/if}

							<div class="inline-edit-actions">
								<div class="left-actions">
									<button
										type="button"
										class="action-btn"
										onclick={() => (showIdeaPicker = true)}
										disabled={isSubmitting}
									>
										<Plus size={14} class="inline-icon" />
										{m.proposal_detail_add_another()}
									</button>
								</div>
								<div class="right-actions" style="display: flex; gap: 0.5rem;">
									<button
										type="button"
										class="action-btn cancel-btn"
										onclick={() => (isEditing = false)}
										disabled={isSubmitting}
									>
										{m.proposal_detail_cancel()}
									</button>
									<button
										type="submit"
										class="action-btn publish-btn"
										disabled={isSubmitting ||
											!editTitle.trim() ||
											!editContent.trim() ||
											!editRationale.trim()}
									>
										{isSubmitting ? m.editor_publishing() : m.editor_publish()}
									</button>
								</div>
							</div>
						</form>
					{:else if sol.content}
						<div class="proposal-body">
							<WysiwygMarkdownEditor
								html={sol.content}
								editable={false}
								emptyText={m.proposal_detail_no_content()}
							/>
						</div>
					{/if}
				</div>

				<div class="proposal-actions-inline">
					<!-- Engagement Cluster -->
					<div class="action-cluster engagement-cluster">
						{#if data.question.current_phase_name !== 'Voting'}
							<div class="action-btn-wrapper">
								<VoteControls
									targetId={sol.id}
									idFieldName="proposalId"
									subjectLabel="proposal"
									action={`/questions/${questionId}/proposals?/vote`}
									subscriptionCount={sol.subscription_count ?? 0}
									userVote={data.userVote ?? 0}
									canVote={Boolean(data.user)}
									onVoteSuccess={(sc) => (subscriptionCount = sc)}
								/>
							</div>
						{/if}
						{#if data.user}
							<div class="action-btn-wrapper">
								<button
									class="action-btn"
									style="width: 100%; justify-content: center; color: var(--color-text-secondary);"
									onclick={handleHide}
								>
									<EyeOff size={14} class="inline-icon" />
									{m.idea_card_hide()}
								</button>
							</div>
						{/if}
					</div>

					<!-- Action Cluster -->
					{#if data.user}
						<div class="action-cluster creation-cluster">
							{#if isRemixingEnabled(data.question.current_phase_name) && !isEditing}
								<div class="action-btn-wrapper">
									<button
										class="action-btn remix-btn"
										style="width: 100%; justify-content: center;"
										onclick={() => {
											editTitle = sol.title;
											editContent = sol.content;
											editRationale = '';
											submitError = '';
											isEditing = true;
										}}
									>
										<Pen size={14} class="inline-icon" />
										{T.TERM_REMIX()}
									</button>
								</div>
							{/if}
							<div class="action-btn-wrapper">
								<CompareButton
									proposal={sol}
									addedText={m.compare_button_added()}
									compareText={m.compare_button()}
									buttonClass="action-btn"
									size={16}
									style="width: 100%; justify-content: center; height: var(--touch-min, 44px);"
								/>
							</div>
						</div>
					{/if}
				</div>

				{@render provenance()}
				<!-- ══ H. Discussion (REMOVED) ══ -->
			</div>
		</div>
	</div>
{/key}

<IdeaPickerModal
	isOpen={showIdeaPicker}
	proposals={allProposals.filter((p) => p.id !== sol.id)}
	userVotes={data.userProposalVotes ?? {}}
	labels={data.labels ?? []}
	onClose={() => (showIdeaPicker = false)}
	onSelect={(selected) => {
		showIdeaPicker = false;
		isEditing = false;

		editorState._combinePrefill = {
			title: editTitle,
			content: editContent,
			rationale: editRationale
		};

		editorState.comparePool = [sol, selected];
		editorState.openCompareFromPool();
		goto(localizePath(`/questions/${questionId}/proposals/compare`));
	}}
/>

<style>
	/* ── Page container ── */
	.detail-page {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow-y: auto;
		background: var(--bg-primary, #fff);
	}

	/* ── Detail view container ──────────────────────────────────────── */
	.desktop-layout {
		display: flex;
		flex-direction: column;
		flex: 1;
		width: 100%;
		max-width: 1200px;
		margin: 0 auto;
	}

	@media (min-width: 769px) {
		.desktop-layout {
			flex-direction: row;
			align-items: flex-start;
		}
	}

	.detail-view {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		padding: clamp(1rem, 4vw, 2rem);
		padding-top: 0.5rem;
		box-sizing: border-box;
		width: 100%;
		min-width: 0; /* allows flex items to shrink below their minimum intrinsic size */
	}

	/* ── Header ─────────────────────────────────────────────────────── */
	.detail-header {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.labels-interactive-container {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		width: 100%;
	}

	.labels-scrollable-bar {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		overflow-x: auto;
		white-space: nowrap;
		flex: 1;
		scrollbar-width: none;
	}

	.labels-scrollable-bar::-webkit-scrollbar {
		display: none;
	}

	.labels-scrollable-bar.expanded {
		flex-wrap: nowrap;
		flex-direction: column;
		align-items: flex-start;
		white-space: normal;
	}

	.labels-toggle-btn {
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 0.2rem;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--muted, #666);
		border-radius: 4px;
	}

	.labels-toggle-btn:hover {
		background: var(--color-surface-100, #eee);
	}

	.label-chip {
		display: inline-block;
		padding: 0.2rem 0.6rem;
		border-radius: 9999px;
		font-size: 0.75rem;
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

	.label-stat-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--line, #ddd);
		border-radius: 6px;
		background: var(--paper, #fff);
		width: 100%;
	}

	.stat-card-header {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.85rem;
	}

	.stat-card-grid {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.stat-item {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		color: var(--muted, #666);
		position: relative;
		cursor: pointer;
		outline: none;
	}

	.stat-value {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--ink, #111);
	}

	.stat-tooltip {
		display: none;
		position: absolute;
		bottom: calc(100% + 4px);
		left: 50%;
		transform: translateX(-50%);
		background: var(--ink, #111);
		color: #fff;
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		font-size: 0.7rem;
		white-space: nowrap;
		z-index: 10;
		pointer-events: none;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
	}

	.stat-item:hover .stat-tooltip,
	.stat-item:focus .stat-tooltip,
	.stat-item:active .stat-tooltip {
		display: block;
	}

	.time-ago {
		font-size: 0.72rem;
		color: var(--muted, #888);
		margin-left: auto;
	}

	.author-line {
		margin: 0;
		font-size: 0.82rem;
		color: var(--muted, #666);
	}

	/* ── Lineage ────────────────────────────────────────────────────── */

	.lineage-graph-container {
		display: flex;
		flex-direction: column;
	}

	.view-toggle {
		display: flex;
		gap: 2px;
		background: var(--color-surface-100, #eee);
		padding: 2px;
		border-radius: 8px;
	}

	.view-toggle-btn {
		padding: 0.3rem 0.75rem;
		border: none;
		background: transparent;
		border-radius: 6px;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--muted, #888);
		cursor: pointer;
		transition: all 0.15s ease;
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.view-toggle-btn.active {
		background: var(--paper, #fff);
		color: var(--ink, #111);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.view-toggle-btn:hover:not(.active) {
		color: var(--ink, #111);
	}

	.section-label {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted, #888);
	}

	/* ── Core content ──────────────────────────────────────────────── */
	.core-content {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.proposal-title {
		margin: 0;
		font-size: 1.2rem;
		font-weight: 800;
		line-height: 1.3;
	}

	.proposal-body {
		font-size: 0.88rem;
		line-height: 1.6;
	}

	.title-row {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
	}

	/* ── Action Buttons ────────────────────────────────────────────── */
	.proposal-actions-inline {
		margin-top: 1rem;
		margin-bottom: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.action-cluster {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
		width: 100%;
	}

	@media (min-width: 481px) {
		.proposal-actions-inline {
			flex-direction: row;
			gap: 1rem;
		}
		.action-cluster {
			display: flex;
			flex: 1;
			gap: 0.5rem;
		}
	}

	.action-btn-wrapper {
		flex: 1;
		min-width: 0;
	}

	.action-btn-wrapper :global(.vote-wrap),
	.action-btn-wrapper :global(.vote-row),
	.action-btn-wrapper :global(form),
	.action-btn-wrapper :global(button.btn-vote) {
		width: 100%;
	}

	.action-btn {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		height: var(--touch-min, 44px);
		padding: 0 0.8rem;
		border-radius: var(--radius-md, 8px);
		font-size: 0.85rem;
		font-weight: 600;
		background: var(--paper, #fff);
		color: var(--text-secondary, #666);
		border: 1px solid var(--line, #ddd);
		cursor: pointer;
		transition: all 0.15s ease;
		white-space: nowrap;
	}
	.action-btn:hover {
		background: var(--bg-hover, #f5f5f5);
		color: var(--text-primary, #111);
	}

	@media (max-width: 480px) {
		.proposal-actions-inline {
			gap: 0.75rem;
		}
		.action-cluster {
			gap: 0.35rem;
		}
		.action-btn {
			padding: 0 0.35rem;
			font-size: 0.75rem;
			gap: 0.25rem;
		}
		.action-btn-wrapper :global(button.btn-vote) {
			padding: 0 0.35rem !important;
			font-size: 0.75rem !important;
			gap: 0.25rem !important;
		}
	}

	/* ── Inline Edit Form ───────────────────────────────────────────── */
	.inline-edit-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-bottom: 1rem;
		animation: fadeIn 0.3s ease;
	}

	.inline-edit-title-input {
		font-family: var(--font-primary, system-ui, sans-serif);
		font-size: 1.5rem;
		font-weight: 700;
		width: 100%;
		border: 1px solid var(--line, #d8d8d8);
		border-radius: var(--radius-md, 8px);
		padding: 0.5rem 0.75rem;
		color: var(--ink, #111);
		transition: border-color 0.2s;
	}

	.inline-edit-title-input:focus {
		outline: none;
		border-color: var(--primary, #4f7df9);
		box-shadow: 0 0 0 2px rgba(79, 125, 249, 0.2);
	}

	.rationale-section {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.rationale-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.rationale-header label {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--ink, #111);
	}

	.intent-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.intent-chip {
		font-size: 0.65rem;
		font-weight: 600;
		padding: 0.15rem 0.45rem;
		border-radius: 12px;
		background: color-mix(in srgb, var(--primary, #4f7df9) 10%, var(--paper, #fff));
		color: var(--primary, #4f7df9);
		border: 1px solid color-mix(in srgb, var(--primary, #4f7df9) 30%, transparent);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.intent-chip:hover {
		background: color-mix(in srgb, var(--primary, #4f7df9) 20%, var(--paper, #fff));
	}

	.inline-edit-rationale-input {
		font-family: inherit;
		font-size: 0.95rem;
		line-height: 1.5;
		width: 100%;
		border: 1px solid var(--line, #d8d8d8);
		border-radius: var(--radius-md, 8px);
		padding: 0.75rem;
		resize: vertical;
		transition: border-color 0.2s;
	}

	.inline-edit-rationale-input:focus {
		outline: none;
		border-color: var(--primary, #4f7df9);
		box-shadow: 0 0 0 2px rgba(79, 125, 249, 0.2);
	}

	.inline-edit-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
		margin-top: 0.5rem;
	}

	.action-btn.cancel-btn {
		background: transparent;
		color: var(--ink, #111);
		border-color: var(--line, #d8d8d8);
	}

	.action-btn.cancel-btn:hover {
		background: var(--paper-hover, #f8f8f8);
	}

	.action-btn.publish-btn {
		background: var(--primary, #4f7df9);
		color: white;
		border-color: var(--primary, #4f7df9);
	}

	.action-btn.publish-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--primary, #4f7df9) 85%, black);
	}

	.action-btn.publish-btn:disabled {
		opacity: 0.6;
	}
</style>
