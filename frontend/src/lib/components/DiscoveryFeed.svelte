<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import PaginationBar from '$lib/components/PaginationBar.svelte';
	import { tick, untrack } from 'svelte';
	import { enhance, deserialize } from '$app/forms';
	import { invalidate, goto } from '$app/navigation';
	import { localizePath } from '$lib/utils/i18n-path';
	import ProposalCard from './ProposalCard.svelte';
	import FilterBar from './FilterBar.svelte';
	import FeedTabBar from './ui/FeedTabBar.svelte';
	import { feedViewState, getFilterState } from '$lib/feedView.svelte';
	import { editorState } from '$lib/editor.svelte';
	import { voteState } from '$lib/stores/voteState.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { Lightbulb, ClipboardList, Info, ChevronDown, Sparkles, Plus } from '@lucide/svelte';
	import { filterProposals, sortProposals, type SortMode } from '$lib/services/feed-filter';
	import * as T from '$lib/utils/terminology';
	import { logAction } from '$lib/services/telemetry';

	interface Props {
		proposals: App.ProposalRecord[];
		userVotes: Record<string, number>;
		focusQuorum?: number;
		disabled?: boolean;
		creationDisabled?: boolean;
		/** Focus reasons map: proposalId → 'score' | 'velocity' */
		focusReasons?: Record<string, 'score' | 'velocity'>;
		/** Pending migration prompts for the current user */
		migrationPrompts?: any[];
		/** Vote timestamps: proposalId → updated ISO string (for unseen improvement detection) */
		userVoteTimestamps?: Record<string, string>;
		user?: { id: string; name?: string } | null;
		labels?: App.LabelRecord[];
		unseenImprovements?: Record<string, number>;
		seenProposalIds?: string[];
		/* ── Readiness / ballot props ── */
		questionId?: string;
		currentPhase?: string;
		signalsCount?: number;
		totalUsers?: number;
		userHasSignaled?: boolean;
		closingWindowDeadline?: string;
		/** Merge opportunity prompts for the current user */
		mergeOpportunities?: any[];
		/** Pending migration prompts for the current user */
		pendingMigrations?: any[];
		/** Ids of proposals the user has hidden */
		userHiddenProposalIds?: string[];
		/** Display context to control chip visibility */
		filterContext?: 'discover' | 'subscriptions' | 'related';
	}

	let {
		proposals,
		userVotes,
		focusQuorum = 0,
		disabled = false,
		creationDisabled = false,
		focusReasons = {},
		migrationPrompts = [],
		userVoteTimestamps = {},
		user = null,
		labels = [],
		unseenImprovements = {},
		seenProposalIds = [],
		questionId = '',
		currentPhase = 'AnswerSearch',
		signalsCount = 0,
		totalUsers = 0,
		userHasSignaled = false,
		closingWindowDeadline = undefined,
		mergeOpportunities = [],
		pendingMigrations = [],
		userHiddenProposalIds = [],
		filterContext = undefined
	}: Props = $props();

	const combinedHiddenIds = $derived(
		new Set([...userHiddenProposalIds, ...feedViewState.optimisticHidden])
	);

	// Ensure filter state for this context is initialized immediately
	$effect(() => {
		getFilterState(filterContext);
	});

	async function handleHide(proposalId: string) {
		feedViewState.optimisticHidden.push(proposalId);
		voteState.removeVoteOptimistically(proposalId);
		logAction('hide_proposal', { question: questionId, target_id: proposalId });
		const fd = new FormData();
		fd.append('proposalId', proposalId);
		const actionUrl = localizePath(`/questions/${questionId}/proposals`) + '?/hide';
		try {
			const res = await fetch(actionUrl, {
				method: 'POST',
				body: fd,
				headers: { 'x-sveltekit-action': 'true' }
			});
			const text = await res.text();
			const result = deserialize(text);
			if (result.type === 'failure' || result.type === 'error') {
				throw new Error('Hide action failed');
			}
			invalidate('app:proposals');
		} catch (err) {
			// Rollback on failure
			feedViewState.optimisticHidden = feedViewState.optimisticHidden.filter(
				(id) => id !== proposalId
			);
		}
	}

	async function handleRestore(proposalId: string) {
		feedViewState.optimisticHidden = feedViewState.optimisticHidden.filter(
			(id) => id !== proposalId
		);
		logAction('restore_proposal', { question: questionId, target_id: proposalId });
		const fd = new FormData();
		fd.append('proposalId', proposalId);
		try {
			const res = await fetch(localizePath(`/questions/${questionId}/proposals`) + '?/unhide', {
				method: 'POST',
				body: fd,
				headers: { 'x-sveltekit-action': 'true' }
			});
			const result = deserialize(await res.text());
			if (result.type === 'failure' || result.type === 'error') {
				throw new Error('Unhide action failed');
			}
			invalidate('app:proposals');
		} catch (err) {
			// Rollback on failure
			if (!feedViewState.optimisticHidden.includes(proposalId)) {
				feedViewState.optimisticHidden.push(proposalId);
			}
			console.error('Failed to restore proposal', err);
		}
	}

	// ── Sub-view toggle: All Proposals / Actions ─────
	type SubView = 'all' | 'actions';
	let subView = $state<SubView>('all');

	const seenProposalSet = $derived(new Set([...seenProposalIds, ...feedViewState.optimisticSeen]));

	const effectiveUnseenImprovements = $derived.by(() => {
		if (!user) return {};
		const map: Record<string, number> = {};
		for (const p of proposals) {
			let count = 0;
			for (const child of proposals) {
				if (child.parent_proposals?.includes(p.id) && !seenProposalSet.has(child.id)) {
					count++;
				}
			}
			if (count > 0) map[p.id] = count;
		}
		return map;
	});
	// Filter chip state lives in feedViewState (shared with graph/map)

	// ── Readiness / ballot local state ─────────────────────────────────
	let localSignalsCount = $state(untrack(() => signalsCount));
	let localUserHasSignaled = $state(untrack(() => userHasSignaled));
	let signaling = $state(false);
	let showFocusExplainer = $state(false);

	$effect(() => {
		localSignalsCount = signalsCount;
	});
	$effect(() => {
		localUserHasSignaled = userHasSignaled;
	});

	const isClosing = $derived(currentPhase === 'Closing');
	const isVoting = $derived(currentPhase === 'Voting');
	const isAnswerSearch = $derived(currentPhase === 'AnswerSearch');
	const percentReady = $derived(
		totalUsers > 0 ? Math.round((localSignalsCount / totalUsers) * 100) : 0
	);

	const authoredCount = $derived(user ? proposals.filter((p) => p.author === user.id).length : 0);

	// Ballot entries: focus champions sorted by support
	const ballotEntries = $derived.by(() => {
		const winners = proposals
			.filter((s) => s.state === 'FinalWinner')
			.sort((a, b) => (b.subscription_count ?? 0) - (a.subscription_count ?? 0));
		const champions = proposals
			.filter((s) => s.in_focus && s.state === 'Proposed')
			.sort((a, b) => (b.subscription_count ?? 0) - (a.subscription_count ?? 0));
		if (isVoting) return winners.length > 0 ? winners : champions;
		return champions;
	});

	// Countdown timer for closing window
	let timeLeft = $state('');
	$effect(() => {
		if (!isClosing || !closingWindowDeadline) {
			return;
		}

		const target = new Date(closingWindowDeadline).getTime();
		const interval = setInterval(() => {
			const diff = target - Date.now();
			if (diff <= 0) {
				timeLeft = m.discovery_finalizing();
				clearInterval(interval);
				return;
			}
			const h = Math.floor(diff / 3600000);
			const mins = Math.floor((diff % 3600000) / 60000);
			timeLeft = `${h}h ${mins}m`;
		}, 1000);
		return () => clearInterval(interval);
	});

	// Sync sub-view and champion IDs to shared store so the layout can filter the DagMap
	$effect(() => {
		feedViewState.subView = subView;
		feedViewState.championIds = championIdSet;
	});

	// When the DAG sets a selectedClusterIdx, switch to All display
	$effect(() => {
		if (feedViewState.selectedClusterIdx !== null) {
			subView = 'all';
		}
	});

	// ── Sort mode ──────────────────────────────────────────────────────
	// Sorted mode and direction are managed globally in feedViewState

	// ── Pagination ─────────────────────────────────────────────────────
	let currentPage = $state(1);
	const PAGE_SIZE = 10;

	$effect(() => {
		// Reset to page 1 whenever filters, sort mode, or sort direction change
		filteredSols;
		feedViewState.sortModeByContext[filterContext || 'discover'];
		feedViewState.sortDirectionByContext[filterContext || 'discover'];
		untrack(() => {
			currentPage = 1;
		});
	});

	// Grouping states for All tab only
	let temporarilyInjectedParents = $state(new Set<string>());

	function onLocateParent(parentId: string) {
		if (!proposalsMap.has(parentId)) return;

		// Inject parent if it's currently filtered out
		if (!temporarilyInjectedParents.has(parentId)) {
			const wasHidden = !allProposals.some((p) => p.id === parentId);
			if (wasHidden) {
				temporarilyInjectedParents.add(parentId);
				temporarilyInjectedParents = new Set(temporarilyInjectedParents);
			}
		}

		tick().then(() => {
			const el = document.getElementById(`idea-card-${parentId}`);
			if (el) {
				el.scrollIntoView({ behavior: 'smooth', block: 'center' });
				el.classList.add('pulse-highlight');
				setTimeout(() => {
					el.classList.remove('pulse-highlight');
				}, 1500);
			}
		});
	}

	// Set of champion IDs — always dynamically computed from highest subscription_count per primary_label
	const championIdSet = $derived.by(() => {
		const ids = new Set<string>();
		const labelBest = new Map<string, App.ProposalRecord>();

		for (const s of proposals) {
			const key = s.primary_label;
			if (!key) continue;

			const existing = labelBest.get(key);
			const currentScore = s.subscription_count ?? 0;
			const existingScore = existing?.subscription_count ?? 0;

			if (!existing || currentScore > existingScore) {
				labelBest.set(key, s);
			} else if (currentScore === existingScore) {
				// Tie breaker: older proposal wins
				if (new Date(s.created) < new Date(existing.created)) {
					labelBest.set(key, s);
				}
			}
		}

		for (const champ of labelBest.values()) {
			ids.add(champ.id);
		}

		return ids;
	});

	const proposalsMap = $derived(new Map(proposals.map((s) => [s.id, s])));

	// Competitive entry bar: subscription_count of the weakest Focus member.
	const focusEntryBar = $derived.by(() => {
		const inFocus = proposals.filter((s) => s.in_focus).map((s) => s.subscription_count ?? 0);
		if (inFocus.length === 0) return focusQuorum;
		if (inFocus.length < 10) return focusQuorum;
		return Math.max(focusQuorum, Math.min(...inFocus));
	});

	// ── Focus: proposals in the Current Focus (always sorted by score) ──
	const focusProposals = $derived.by(() => {
		const active = proposals.filter((s) => s.in_focus);
		return [...active].sort((a, b) => {
			const diff = (b.subscription_count ?? 0) - (a.subscription_count ?? 0);
			if (diff !== 0) return diff;
			return new Date(b.created).getTime() - new Date(a.created).getTime();
		});
	});

	// Max subscription count across all focus proposals — used to scale the support bar in focus cards
	const focusMaxSupport = $derived(
		focusProposals.reduce((max, s) => Math.max(max, s.subscription_count ?? 0), 1)
	);

	const labelAffinities = $derived.by(() => {
		const affinities = new Map<string, number>();
		for (const p of proposals) {
			const vote = userVotes[p.id];
			if (vote && vote > 0) {
				for (const l of p.labels || []) {
					affinities.set(l, (affinities.get(l) ?? 0) + 1);
				}
			}
		}
		return affinities;
	});

	const baseOpts = $derived.by(() => {
		const fState = getFilterState(filterContext);
		return {
			onlySupported: fState.onlySupported,
			onlyAuthored: fState.onlyAuthored || fState.feedTab === 'mine',
			onlyInFocus: fState.onlyInFocus,
			onlyChampions: fState.onlyChampions,
			onlyCombinations: fState.onlyCombinations,
			onlyImprovements: fState.onlyImprovements,
			onlyUnseen: fState.onlyUnseen,
			onlyHidden: fState.feedTab === 'hidden',
			comparePoolIds: new Set(editorState.comparePool.map((p) => p.id)),
			userVotes,
			userId: user?.id,
			championIds: feedViewState.championIds,
			searchQuery: fState.searchQuery,
			seenProposalIds: seenProposalSet,
			userHiddenProposalIds: combinedHiddenIds,
			hideSubscribed:
				(fState.feedTab === 'foryou' ||
					feedViewState.sortModeByContext[filterContext || 'discover'] === 'PersonalFocus') &&
				filterContext !== 'subscriptions',
			labelAffinities
		};
	});

	const availableLabels = $derived.by(() => {
		if (!labels) return [];
		const opts = { ...baseOpts, selectedLabelId: null };
		const filterable = filterProposals(proposals, temporarilyInjectedParents, opts);
		const present = new Set<string>();
		for (const p of filterable) {
			if (p.primary_label) present.add(p.primary_label);
			if (p.labels) {
				for (const lId of p.labels) present.add(lId);
			}
		}
		return labels.filter((l) => present.has(l.id));
	});

	const filteredSols = $derived.by(() => {
		const fState = getFilterState(filterContext);
		const opts = {
			...baseOpts,
			selectedLabelId:
				fState.selectedLabelId ||
				(feedViewState.selectedClusterIdx !== null && labels
					? labels[feedViewState.selectedClusterIdx]?.id
					: null)
		};

		let finalSols = filterProposals(proposals, temporarilyInjectedParents, opts);

		let currentSortMode = feedViewState.sortModeByContext[filterContext || 'discover'];
		let currentSortDir = feedViewState.sortDirectionByContext[filterContext || 'discover'];

		if (filterContext === 'discover') {
			if (fState.feedTab === 'foryou') {
				currentSortMode = 'PersonalFocus';
				currentSortDir = 'desc';
			} else if (fState.feedTab === 'hidden') {
				currentSortMode = 'Newest'; // Hidden proposals usually best sorted by newest
				currentSortDir = 'desc';
			}
		}

		finalSols = sortProposals(finalSols, currentSortMode, opts, currentSortDir);
		return finalSols;
	});

	// Rank map: proposalId → 1-based rank position in focusProposals (sorted by score)
	const focusRankMap = $derived(new Map(focusProposals.map((s, i) => [s.id, i + 1])));

	// ── All: all non-terminal proposals — filtered via feed-filter utilities ──
	const allProposals = $derived.by(() => {
		return filteredSols;
	});

	const paginatedProposals = $derived.by(() => {
		const start = (currentPage - 1) * PAGE_SIZE;
		return allProposals.slice(start, start + PAGE_SIZE);
	});
	const totalPagesProposals = $derived(Math.ceil(allProposals.length / PAGE_SIZE));

	// Derived list based on active sub-view
	const displayedProposals = $derived(allProposals);

	// ── Unseen improvements: now computed on the backend via props ──────

	// ── Pending migration prompts for Actions Center ──
</script>

<div class="discovery-feed">
	<!-- ═══ FilterBar (shown when viewing all proposals) ═══ -->
	{#if subView === 'all'}
		{#if filterContext === 'discover'}
			<FeedTabBar
				bind:feedTab={feedViewState.filterByContext['discover'].feedTab}
				{authoredCount}
			/>
		{/if}
		<FilterBar
			context={filterContext}
			bind:sortMode={feedViewState.sortModeByContext[filterContext || 'discover']}
			bind:sortDirection={feedViewState.sortDirectionByContext[filterContext || 'discover']}
			bind:onlySupported={feedViewState.filterByContext[filterContext || 'discover'].onlySupported}
			bind:onlyAuthored={feedViewState.filterByContext[filterContext || 'discover'].onlyAuthored}
			bind:onlyInFocus={feedViewState.filterByContext[filterContext || 'discover'].onlyInFocus}
			bind:onlyChampions={feedViewState.filterByContext[filterContext || 'discover'].onlyChampions}
			bind:onlyCombinations={
				feedViewState.filterByContext[filterContext || 'discover'].onlyCombinations
			}
			bind:onlyImprovements={
				feedViewState.filterByContext[filterContext || 'discover'].onlyImprovements
			}
			bind:onlyUnseen={feedViewState.filterByContext[filterContext || 'discover'].onlyUnseen}
			bind:searchQuery={feedViewState.filterByContext[filterContext || 'discover'].searchQuery}
			bind:selectedLabelId={
				feedViewState.filterByContext[filterContext || 'discover'].selectedLabelId
			}
			showHiddenFilter={false}
			userId={user?.id}
			labels={availableLabels}
		/>
	{/if}

	<!-- ═══ Proposal cards ═══ -->
	{#if subView !== 'actions'}
		<div class="feed-cards-scroll">
			{#if displayedProposals.length === 0}
				{@const fState = getFilterState(filterContext)}
				{@const hasFilters =
					(fState.onlySupported && filterContext !== 'subscriptions') ||
					fState.onlyInFocus ||
					fState.onlyChampions ||
					fState.onlyCombinations ||
					fState.onlyImprovements ||
					fState.onlyUnseen ||
					fState.selectedLabelId !== null ||
					fState.searchQuery.trim().length > 0}
				<div class="empty-state">
					{#if filterContext === 'subscriptions'}
						<p>
							{hasFilters ? m.feed_empty_subscriptions_filtered() : m.feed_empty_subscriptions()}
						</p>
					{:else if fState.feedTab === 'foryou'}
						<p>{hasFilters ? m.feed_empty_foryou_filtered() : m.feed_empty_foryou()}</p>
					{:else if fState.feedTab === 'mine'}
						<p>{hasFilters ? m.feed_empty_mine_filtered() : m.feed_empty_mine()}</p>
						{#if !hasFilters && !creationDisabled}
							<button
								type="button"
								class="create-btn empty-create-btn"
								onclick={() => goto(localizePath(`/questions/${questionId}/proposals/new`))}
								style="margin: 1rem auto 0; display: inline-flex;"
							>
								<span class="create-icon"><Plus size={16} /></span>
								<span class="create-label"
									>{m.discovery_empty_first_proposal({ proposalTerm: T.TERM_PROPOSALS() })}</span
								>
							</button>
						{/if}
					{:else if fState.feedTab === 'hidden'}
						<p>{hasFilters ? m.feed_empty_hidden_filtered() : m.feed_empty_hidden()}</p>
					{:else}
						<!-- feedTab === 'all' or default -->
						{#if hasFilters}
							<p>{m.feed_empty_all_filtered()}</p>
						{:else}
							<p>{m.feed_empty_all_no_ideas()}</p>
							{#if !creationDisabled}
								<button
									type="button"
									class="create-btn empty-create-btn"
									onclick={() => goto(localizePath(`/questions/${questionId}/proposals/new`))}
									style="margin: 1rem auto 0; display: inline-flex;"
								>
									<span class="create-icon"><Plus size={16} /></span>
									<span class="create-label"
										>{m.discovery_empty_first_proposal({ proposalTerm: T.TERM_PROPOSALS() })}</span
									>
								</button>
							{/if}
						{/if}
					{/if}
				</div>
			{:else}
				<!-- All Proposals: flat list -->
				<div class="feed-list">
					{#each paginatedProposals as proposal (proposal.id)}
						{@const labelRecord = labels.find((l) => l.id === proposal.primary_label)}
						{@const barPct =
							Math.min(100, ((proposal.subscription_count ?? 0) / Math.max(1, totalUsers)) * 100) ||
							0}
						{@const clusterColor = labelRecord?.color}
						<ProposalCard
							variant="standard"
							{proposal}
							isSeen={seenProposalSet.has(proposal.id)}
							userVote={userVotes[proposal.id] ?? 0}
							canVote={!disabled}
							unseenImprovementCount={effectiveUnseenImprovements[proposal.id] ?? 0}
							{barPct}
							{clusterColor}
							clusterTitle={labelRecord?.short_name}
							activeLabels={Array.from(
								new Set([
									...(proposal.primary_label ? [proposal.primary_label] : []),
									...(proposal.labels || [])
								])
							)
								.map((id) => labels.find((l) => l.id === id))
								.filter((l): l is App.LabelRecord => Boolean(l))
								.map((l) => ({ id: l.id, short_name: l.short_name, color: l.color }))}
							isChampion={championIdSet.has(proposal.id)}
							isAuthored={!!(user && proposal.author === user.id)}
							subscriptionCount={proposal.subscription_count ?? 0}
							isHidden={combinedHiddenIds.has(proposal.id)}
							onHide={handleHide}
							onRestore={handleRestore}
						/>
					{/each}

					<PaginationBar
						{currentPage}
						totalPages={totalPagesProposals}
						onPageChange={(p) => (currentPage = p)}
					/>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.discovery-feed {
		display: flex;
		flex-direction: column;
		min-width: 0;
		height: 100%;
		overflow: hidden;
	}

	/* ── Scrollable cards area ─────────────────────────────────────────── */
	.feed-cards-scroll {
		flex: 1;
		overflow-y: auto;
		overflow-x: hidden;
		padding-top: 0.75rem;
		/* Ensures content isn't hidden behind the bottom tab bar */
		padding-bottom: calc(var(--bottom-tab-h, 56px) + var(--safe-b, 0px) + 2rem);
	}

	@media (min-width: 1024px) {
		.feed-cards-scroll {
			padding-bottom: 2rem; /* no bottom tab bar on desktop */
		}
	}





	/* ── Feed list ───────────────────────────────────────────────────── */
	.feed-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 0.5rem;
	}

	.empty-state {
		text-align: center;
		padding: 2rem 1rem;
		color: var(--color-text-muted);
		background: var(--color-bg-secondary);
		border-radius: var(--radius-lg);
		border: 1px dashed var(--color-border);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
	}

	.create-btn {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.45rem 0.75rem;
		background: var(--ink, #111);
		color: var(--paper, #fff);
		font-weight: 700;
		font-size: 0.8rem;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		text-decoration: none;
		flex-shrink: 0;
		transition: opacity 0.15s;
	}

	.create-btn:hover {
		opacity: 0.85;
		text-decoration: none;
	}

	.create-icon {
		font-size: 1.1rem;
		line-height: 1;
		font-weight: 800;
	}



	:global(.pulse-highlight) {
		animation: parentPulse 1.5s ease-out;
	}
	@keyframes parentPulse {
		0% {
			box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7);
			border-color: rgba(59, 130, 246, 1);
		}
		50% {
			box-shadow: 0 0 0 10px rgba(59, 130, 246, 0);
			border-color: rgba(59, 130, 246, 1);
		}
		100% {
			box-shadow: 0 0 0 0 rgba(59, 130, 246, 0);
		}
	}
</style>
