<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { editorState } from '$lib/editor.svelte';
	import WysiwygMarkdownEditor from './WysiwygMarkdownEditor.svelte';
	import ContentDiffView from './ContentDiffView.svelte';
	import VoteControls from './VoteControls.svelte';
	import { inlineDiff } from '$lib/utils/block-diff';
	import * as T from '$lib/utils/terminology';
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import { deserialize } from '$app/forms';
	import { goto, invalidate } from '$app/navigation';
	import { localizePath } from '$lib/utils/i18n-path';
	import { getHasNavigated } from '$lib/utils/nav';
	import Button from '$lib/components/ui/Button.svelte';
	import { X, ArrowUpDown, Star, Plus } from '@lucide/svelte';
	import Badge from '$lib/components/ui/Badge.svelte';

	interface Props {
		allProposals: App.ProposalRecord[];
		userVotes?: Record<string, number>;
		canVote?: boolean;
		creationDisabled?: boolean;
		labels?: App.LabelRecord[];
	}

	let {
		allProposals,
		userVotes = {},
		canVote = false,
		creationDisabled = false,
		labels = []
	}: Props = $props();

	const questionId = $derived(page.params.id);

	function goBack() {
		editorState.close();
		if (page.url.pathname.endsWith('/compare')) {
			if (typeof window !== 'undefined' && getHasNavigated()) {
				window.history.back();
			} else {
				void goto(localizePath(`/questions/${questionId}/proposals/ballot`));
			}
		}
	}

	function nodeType(sol: App.ProposalRecord) {
		const isRoot = !sol.parent_proposals || sol.parent_proposals.length === 0;
		const isSynthesis = sol.parent_proposals && sol.parent_proposals.length > 1;
		if (isRoot) return { icon: T.ICON_IDEA, label: m.compare_type_new_idea() };
		if (isSynthesis) return { icon: T.ICON_COMPARE, label: m.compare_type_combine() };
		return { icon: T.ICON_REMIX, label: T.TERM_REMIX() };
	}

	function timeAgo(dateStr: string) {
		const d = new Date(dateStr);
		const diff = Date.now() - d.getTime();
		const hours = Math.floor(diff / (1000 * 60 * 60));
		if (hours < 1) return m.discourse_time_just_now();
		if (hours < 24) return m.discourse_time_hours({ n: String(hours) });
		return m.discourse_time_days({ n: String(Math.floor(hours / 24)) });
	}

	// ── Combine Selection Logic ──
	let combineSelection = $state<string[]>([]);

	$effect(() => {
		if (editorState.isSourceComparison && editorState.sourceComparisonMeta) {
			const meta = editorState.sourceComparisonMeta;
			// For source comparison, set initial selection if not set
			if (combineSelection.length === 0 || combineSelection[1] !== meta.childId) {
				combineSelection = [meta.sourceIds[0], meta.childId];
			}
		} else if (combineSelection.length === 0 && editorState.comparePool.length >= 2) {
			combineSelection = [editorState.comparePool[0].id, editorState.comparePool[1].id];
		}
	});

	const displayedProposals = $derived.by(() => {
		if (editorState.isSourceComparison && editorState.sourceComparisonMeta) {
			// Only show selected source and the child
			return editorState.comparePool.filter((p) => combineSelection.includes(p.id));
		}
		return editorState.comparePool;
	});

	function handleCheck(id: string, checked: boolean) {
		if (checked) {
			if (combineSelection.length >= 2) {
				// Replace the second item (other), keep the base stable
				combineSelection = [combineSelection[0], id];
			} else {
				combineSelection = [...combineSelection, id];
			}
		} else {
			combineSelection = combineSelection.filter((x) => x !== id);
		}
	}

	function swapBase() {
		if (combineSelection.length === 2) {
			combineSelection = [combineSelection[1], combineSelection[0]];
		}
	}

	function handleRemoveColumn(id: string) {
		editorState.removeFromComparePool(id);
		if (combineSelection.includes(id)) {
			combineSelection = combineSelection.filter((x) => x !== id);
		}
	}

	// ── Inline Editor State ──
	let combineTitle = $state('');
	let combineContent = $state('');
	let combineRationale = $state('');

	const combineIntents = $derived([
		m.intent_synthesize_ideas(),
		m.intent_resolve_tensions(),
		m.intent_find_compromise()
	]);

	function applyIntent(intent: string) {
		if (combineRationale.length > 0 && !combineRationale.endsWith(' ')) {
			combineRationale += ', ';
		}
		combineRationale += intent;
	}
	let combineLabelStr = $state('');
	let showLabelInput = $state(false);
	let hasManuallyEditedCombineLabel = $state(false);
	let showInlineEditor = $state(false);
	let isSubmitting = $state(false);
	let submitSuccess = $state(false);
	let submitError = $state('');

	let combinedLabels = $derived.by(() => {
		if (combineSelection.length !== 2) return [];
		const p1 = allProposals.find((p) => p.id === combineSelection[0]);
		const p2 = allProposals.find((p) => p.id === combineSelection[1]);
		return Array.from(new Set([...(p1?.labels || []), ...(p2?.labels || [])]));
	});

	$effect(() => {
		if (showInlineEditor && showLabelInput && !hasManuallyEditedCombineLabel && combineTitle) {
			combineLabelStr = combineTitle.substring(0, 40);
		}
	});

	// References for synchronized scrolling
	let columnRefs: HTMLElement[] = $state([]);

	function handleColumnScroll(e: Event, sourceIndex: number) {
		const target = e.currentTarget as HTMLElement;

		// If this column is being synced programmatically, ignore its events
		if (target.dataset.syncing === 'true') {
			target.dataset.syncing = 'false';
			return;
		}

		requestAnimationFrame(() => {
			for (let i = 0; i < columnRefs.length; i++) {
				const col = columnRefs[i];
				if (i !== sourceIndex && col) {
					// Only sync if there is a meaningful difference (to avoid fractional pixel bouncing)
					if (Math.abs(col.scrollTop - target.scrollTop) > 1) {
						col.dataset.syncing = 'true';
						col.scrollTop = target.scrollTop;
					}
				}
			}
		});
	}

	// Update columns array length to match displayedProposals
	$effect(() => {
		if (columnRefs.length !== displayedProposals.length) {
			columnRefs = new Array(displayedProposals.length);
		}
	});

	let lastBaseId = $state('');

	const isSameCluster = $derived.by(() => {
		if (combineSelection.length !== 2) return false;
		const idea1 =
			allProposals.find((p) => p.id === combineSelection[0]) ||
			editorState.comparePool.find((p) => p.id === combineSelection[0]);
		const idea2 =
			allProposals.find((p) => p.id === combineSelection[1]) ||
			editorState.comparePool.find((p) => p.id === combineSelection[1]);
		if (!idea1 || !idea2) return false;
		const c1 = idea1.primary_label || idea1.id;
		const c2 = idea2.primary_label || idea2.id;
		return c1 === c2;
	});

	$effect(() => {
		if (combineSelection.length === 2 && combineSelection[0] !== lastBaseId) {
			lastBaseId = combineSelection[0];
			const baseIdea =
				allProposals.find((p) => p.id === combineSelection[0]) ||
				editorState.comparePool.find((p) => p.id === combineSelection[0]);

			if (editorState._combinePrefill) {
				combineTitle = editorState._combinePrefill.title;
				combineContent = editorState._combinePrefill.content;
				combineRationale = editorState._combinePrefill.rationale;
				showInlineEditor = true;
				editorState._combinePrefill = null; // consume it

				tick().then(() => {
					const el = document.querySelector('.inline-editor-panel');
					if (el) el.scrollIntoView({ behavior: 'smooth' });
				});
			} else {
				combineContent = baseIdea?.content || '';
				if (isSameCluster) {
					combineTitle = baseIdea?.title || '';
				} else {
					combineTitle = '';
				}
				// Don't auto-open the combine editor — user must click the Combine button.
			}
		} else if (combineSelection.length < 2) {
			lastBaseId = '';
			showInlineEditor = false;
		}
	});

	async function openInlineEditor() {
		if (combineSelection.length === 2) {
			showInlineEditor = true;
			await tick();
			const el = document.querySelector('.inline-editor-panel');
			if (el) {
				el.scrollIntoView({ behavior: 'smooth' });
			}
		}
	}

	function closeInlineEditor() {
		showInlineEditor = false;
	}

	async function handleCombineSubmit() {
		if (combineSelection.length !== 2 || isSubmitting) return;
		if (!combineTitle.trim() || !combineContent.trim() || !combineRationale.trim()) {
			submitError = m.editor_error_fields_required();
			return;
		}

		isSubmitting = true;
		submitError = '';

		const formData = new FormData();
		formData.append('title', combineTitle.trim());
		formData.append('content', combineContent);
		formData.append('reason_for_change', combineRationale.trim());
		if (showLabelInput && combineLabelStr.trim()) {
			formData.append('label', combineLabelStr.trim());
		}
		formData.append('parent_ids', combineSelection[0]);
		formData.append('parent_ids', combineSelection[1]);
		formData.append('base_parent', combineSelection[0]);

		try {
			const res = await fetch(localizePath(`/questions/${questionId}/proposals/editor`), {
				method: 'POST',
				headers: { 'x-sveltekit-action': 'true' },
				body: formData
			});

			const text = await res.text();
			const result = deserialize(text);

			if (result.type === 'failure') {
				submitError = (result.data?.message as string) || m.editor_error_publish_failed();
				isSubmitting = false;
				return;
			}
			if (result.type === 'error') {
				submitError = m.editor_error_generic();
				isSubmitting = false;
				return;
			}

			const newProposalId =
				result.type === 'success' ? ((result.data?.id as string) ?? null) : null;

			submitSuccess = true;
			await new Promise((r) => setTimeout(r, 600));

			await invalidate('app:proposals');

			if (newProposalId) {
				await goto(localizePath(`/questions/${questionId}/proposals/${newProposalId}`), {
					replaceState: true
				});
			} else {
				await goto(localizePath(`/questions/${questionId}/proposals/ballot`), {
					replaceState: true
				});
			}

			editorState.close();
			isSubmitting = false;
		} catch (err) {
			console.error(err);
			submitError = m.editor_error_network();
			isSubmitting = false;
		}
	}
</script>

<div class="compare-sheet-container">
	<div class="compare-header">
		<div class="header-title-group">
			<h3 class="compare-title">{m.dag_tab_compare()}</h3>
		</div>
		<div class="header-actions">
			<Button
				variant="secondary"
				size="sm"
				class="diff-toggle-btn {editorState.showDiffHighlight ? 'active' : ''}"
				onclick={() => {
					editorState.showDiffHighlight = !editorState.showDiffHighlight;
				}}
				title={m.compare_highlight_changes_aria()}
				aria-label={m.compare_highlight_changes_aria()}
			>
				{m.compare_highlight_changes_btn()}
			</Button>
		</div>
	</div>

	<div class="compare-content">
		{#if editorState.isSourceComparison && editorState.sourceComparisonMeta?.reasonForChange}
			<div class="reason-for-change-header standalone">
				<strong class="reason-label">{m.compare_reason_for_change()}</strong>
				<div class="reason-text">
					"{editorState.sourceComparisonMeta.reasonForChange}"
				</div>
			</div>
		{/if}

		{#if editorState.isSourceComparison && editorState.sourceComparisonMeta && editorState.sourceComparisonMeta.sourceIds.length > 1}
			<div class="source-selector">
				<span class="source-selector-label">{m.compare_against_source()}</span>
				<select
					bind:value={combineSelection[0]}
					class="source-selector-select"
					aria-label={m.compare_against_source()}
				>
					{#each editorState.sourceComparisonMeta.sourceIds as sourceId}
						{@const sol = allProposals.find((p) => p.id === sourceId)}
						<option value={sourceId}>{sol?.title || m.compare_unknown_source()}</option>
					{/each}
				</select>
			</div>
		{/if}

		<!-- The large source comparison banner was removed; reason for change is now in the sticky header -->
		{#if displayedProposals.length === 0}
			<div class="empty-state">{m.compare_empty()}</div>
		{:else}
			<div class="side-by-side horizontal-scroll">
				{#each displayedProposals as sol, index (sol.id)}
					{@const actualSol = allProposals.find((p) => p.id === sol.id) || sol}
					{@const isBase = combineSelection[0] === sol.id}
					{@const isSelectedOther = combineSelection[1] === sol.id}
					{@const type = nodeType(actualSol)}
					{@const Icon = type.icon}
					{@const fallbackKey = actualSol.primary_label || actualSol.id}
					{@const clusterColor = labels.find((c) => c.id === fallbackKey)?.color ?? '#a9a9a9'}

					<div
						class="compare-column {isBase ? 'is-base-idea' : ''} {isSelectedOther
							? 'is-selected-other'
							: ''}"
						class:selected={combineSelection.includes(sol.id)}
						bind:this={columnRefs[index]}
						onscroll={(e) => handleColumnScroll(e, index)}
					>
						<div class="column-header-row">
							<div class="column-selection">
								{#if editorState.isSourceComparison && editorState.sourceComparisonMeta}
									{#if editorState.sourceComparisonMeta.childId === sol.id}
										<span
											class="selection-badge other-badge"
											style="background: var(--primary); color: white;"
											>{m.compare_badge_remix()}</span
										>
									{:else}
										<span
											class="selection-badge base-badge"
											style="background: var(--color-surface-200); color: var(--color-text);"
											>{m.compare_badge_source()}</span
										>
									{/if}
								{:else}
									{#if !creationDisabled}
										<input
											type="checkbox"
											class="selection-checkbox"
											checked={combineSelection.includes(sol.id)}
											onchange={(e) => handleCheck(sol.id, e.currentTarget.checked)}
										/>
									{/if}
									{#if combineSelection[0] === sol.id}
										<span class="selection-badge base-badge"> {m.compare_badge_base()} </span>
									{:else if combineSelection[1] === sol.id}
										<button
											class="selection-badge other-badge swap-base-btn"
											onclick={swapBase}
											title={m.compare_make_base()}
											aria-label={m.compare_make_base()}
										>
											{m.compare_badge_other()}
										</button>
									{/if}
								{/if}
							</div>

							<div class="column-vote">
								<VoteControls
									targetId={sol.id}
									idFieldName="proposalId"
									subjectLabel={m.common_subject_idea()}
									action={`/questions/${questionId}/proposals?/vote`}
									subscriptionCount={sol.subscription_count ?? 0}
									userVote={userVotes[sol.id] ?? 0}
									{canVote}
								/>
								<Button
									variant="icon"
									class="btn-remove-column"
									onclick={() => handleRemoveColumn(sol.id)}
									title={m.compare_remove()}
								>
									<X size={14} />
								</Button>
							</div>
						</div>

						<div class="sol-view">
							<div class="sol-meta">
								<span
									class="cluster-dot"
									style="background-color: {clusterColor}; width: 12px; height: 12px; border-radius: 50%; display: inline-block; flex-shrink: 0;"
									title={m.compare_group_color()}
								></span>
								<span class="sol-type-badge"
									><Icon size={14} class="inline-icon" /> {type.label}</span
								>
								{#if actualSol.is_champion}
									<span class="sol-status-pill sol-champion">
										<Star size={14} class="inline-icon" />
										{m.compare_top_idea()}
									</span>
								{/if}
								<span class="sol-author">
									{actualSol.author_name || m.common_anonymous()} · {timeAgo(actualSol.created)}
								</span>
							</div>
							<h3 class="sol-title">
								{actualSol.title || m.compare_sheet_untitled()}
								<a
									href={localizePath(
										`/questions/${actualSol.question || questionId}/proposals/${actualSol.id}`
									)}
									class="jump-link"
									title={m.compare_view_details()}
									onclick={() => editorState.close()}
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										width="14"
										height="14"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
										></path><polyline points="15 3 21 3 21 9"></polyline><line
											x1="10"
											y1="14"
											x2="21"
											y2="3"
										></line></svg
									>
								</a>
							</h3>
							<div class="sol-content">
								{#if combineSelection[0] !== sol.id && editorState.showDiffHighlight && combineSelection.length > 0}
									{@const baseSolContent =
										editorState.comparePool.find((p) => p.id === combineSelection[0])?.content ??
										''}
									<div class="diff-rendered-content ProseMirror">
										<ContentDiffView baseHtml={baseSolContent} currentHtml={sol.content ?? ''} />
									</div>
								{:else}
									<WysiwygMarkdownEditor
										html={sol.content ?? ''}
										editable={false}
										emptyText={m.common_no_content()}
									/>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		{#if !showInlineEditor && !creationDisabled && !editorState.isSourceComparison}
			<div class="combine-action-bar">
				<Button
					variant="primary"
					class="btn-combine"
					disabled={combineSelection.length !== 2}
					onclick={openInlineEditor}
				>
					<T.ICON_COMPARE size={14} class="inline-icon" />
					{#if combineSelection.length === 2}
						{editorState.comparePool.length === 2
							? m.compare_combine_ideas()
							: m.compare_combine_selected()}
					{:else}
						{m.compare_select_two()}
					{/if}
				</Button>
			</div>
		{/if}
	</div>

	{#if combineSelection.length === 2 && showInlineEditor}
		<div class="inline-editor-panel">
			<div class="editor-panel-header">
				<div class="header-left">
					<h3>{m.compare_combine_header()}</h3>
				</div>
				<Button
					variant="icon"
					class="close-editor-btn"
					onclick={closeInlineEditor}
					aria-label={m.editor_close_aria()}><X size={18} /></Button
				>
			</div>
			<div class="editor-panel-body">
				<div class="swap-base-container">
					<Button variant="secondary" class="swap-action-btn w-full" onclick={swapBase}>
						<ArrowUpDown size={14} class="inline-icon" style="margin-right:0.5rem;" />
						{m.compare_swap_base()}
					</Button>
				</div>

				<div class="field">
					<label class="field-label" for="editor-title">{m.editor_sheet_title()}</label>
					{#if isSameCluster}
						<div class="field-readonly">{combineTitle}</div>
					{:else}
						<input
							id="editor-title"
							class="field-input"
							bind:value={combineTitle}
							maxlength="120"
							placeholder={m.editor_sheet_title_placeholder()}
						/>
					{/if}
				</div>

				<div class="field">
					<span class="field-label">{m.combine_inherited_labels()}</span>
					<div
						class="inherited-labels-row"
						style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.5rem;"
					>
						{#each combinedLabels as labelId (labelId)}
							{@const l = labels?.find((lbl) => lbl.id === labelId)}
							{#if l}
								<Badge label={l.short_name} color={l.color} theme="custom" shape="pill" />
							{/if}
						{/each}
					</div>

					{#if !showLabelInput}
						<div
							class="add-label-prompt"
							style="display: flex; align-items: center; justify-content: space-between; background: color-mix(in srgb, var(--ink, #111) 2%, var(--paper, #fff)); border: 1px dashed var(--line, #ddd); border-radius: 6px; padding: 0.5rem 0.75rem; margin-top: 0.5rem;"
						>
							<span class="field-hint" style="margin: 0; color: var(--ink, #333);"
								>{m.combine_add_label_prompt()}</span
							>
							<Button
								variant="icon"
								onclick={() => (showLabelInput = true)}
								aria-label={m.compare_add_label_aria()}
							>
								<Plus size={16} />
							</Button>
						</div>
					{:else}
						<label class="field-label" for="editor-label" style="margin-top: 0.5rem;"
							>{m.combine_new_label()}</label
						>
						<div style="display: flex; gap: 0.5rem; align-items: center;">
							<input
								id="editor-label"
								class="field-input"
								style="flex: 1;"
								bind:value={combineLabelStr}
								oninput={() => (hasManuallyEditedCombineLabel = true)}
								maxlength="40"
								placeholder={m.combine_new_label_placeholder()}
							/>
							<Button
								variant="icon"
								onclick={() => {
									showLabelInput = false;
									combineLabelStr = '';
									hasManuallyEditedCombineLabel = false;
								}}
								aria-label={m.compare_remove_label_aria()}
							>
								<X size={16} />
							</Button>
						</div>
						<p class="field-hint">
							{m.combine_new_label_hint()}
						</p>
					{/if}
				</div>

				<div class="field">
					<span class="field-label">{m.editor_sheet_content()}</span>
					<div class="editor-wysiwyg-wrap">
						<WysiwygMarkdownEditor
							name="content"
							bind:html={combineContent}
							placeholder={m.editor_sheet_description_placeholder()}
							ariaLabel={m.editor_content_aria()}
						/>
					</div>
				</div>

				<div class="field">
					<div class="field-label-row">
						<label class="field-label" for="editor-rationale"
							>{m.compare_combine_rationale_label()}</label
						>
						<div class="intent-chips">
							{#each combineIntents as intent}
								<button type="button" class="intent-chip" onclick={() => applyIntent(intent)}>
									{intent}
								</button>
							{/each}
						</div>
					</div>
					<textarea
						id="editor-rationale"
						class="field-textarea"
						bind:value={combineRationale}
						placeholder={m.compare_combine_rationale_placeholder()}
						rows="2"
					></textarea>
				</div>

				{#if submitError}
					<p class="error-msg">{submitError}</p>
				{/if}

				<div class="editor-panel-actions">
					<button
						class="btn btn-combine"
						onclick={handleCombineSubmit}
						disabled={isSubmitting ||
							!combineTitle.trim() ||
							!combineContent.trim() ||
							!combineRationale.trim() ||
							submitSuccess}
						style={submitSuccess ? 'background-color: var(--success, #10b981); color: white;' : ''}
					>
						{isSubmitting
							? m.editor_publishing()
							: submitSuccess
								? '✓ Published!'
								: m.compare_publish_combination()}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.field-label-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 0.2rem;
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
	/* ── Container ── */
	.compare-sheet-container {
		display: flex;
		flex-direction: column;
		background: var(--color-bg-primary, #fff);
	}

	.compare-header {
		padding: 0.75rem 1rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
		justify-content: space-between;
		background: var(--color-bg-secondary, #f9f9f9);
		position: sticky;
		top: 0;
		z-index: 10;
		border-bottom: 1px solid var(--line, #eee);
	}

	.header-title-group {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
		flex: 1;
	}

	.compare-title {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--color-text, #111);
		line-height: 1.2;
	}

	.reason-for-change-header {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
	}

	.reason-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-secondary, #666);
		white-space: nowrap;
	}

	.reason-text {
		font-size: 0.85rem;
		color: var(--color-text, #111);
		font-style: italic;
		line-height: 1.4;
	}

	.reason-for-change-header.standalone {
		margin: 1rem 1rem 0 1rem;
		padding: 0.75rem;
		background: var(--color-bg-tertiary, #f0f0f0);
		border-left: 3px solid var(--primary, #4f7df9);
		border-radius: 4px;
	}

	.source-selector {
		margin: 1rem 1rem 0 1rem;
		padding: 0.75rem;
		background: var(--bg-secondary, #f9f9f9);
		border: 1px solid var(--line, #eee);
		border-radius: 4px;
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.source-selector-label {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-primary, #111);
	}

	.source-selector-select {
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--line, #ddd);
		border-radius: 4px;
		font-size: 0.85rem;
		background: var(--paper, #fff);
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.compare-content {
		flex: 1;
		display: flex;
		flex-direction: column;
		position: relative;
	}

	.empty-state {
		padding: 2rem;
		text-align: center;
		color: var(--text-muted, #888);
		font-size: 0.9rem;
	}

	/* ── Horizontal Scroll ── */
	.horizontal-scroll {
		flex: none;
		display: flex;
		flex-direction: row;
		overflow-x: auto;
		scroll-snap-type: x mandatory;
		-webkit-overflow-scrolling: touch;
		min-height: 60vh;
		gap: 1rem;
		padding: 1rem;
		background: var(--color-bg-secondary, #f9f9f9);
		align-items: stretch;
	}

	.horizontal-scroll::-webkit-scrollbar {
		height: 8px;
	}
	.horizontal-scroll::-webkit-scrollbar-thumb {
		background: var(--line, #ccc);
		border-radius: 4px;
	}

	.compare-column {
		position: relative;
		/* Use 45% so the next card peeks in instead of fitting exactly 2 */
		flex: 0 0 calc(45% - 0.5rem);
		min-width: 280px;
		max-width: 800px;
		background: var(--paper, #fff);
		border-radius: var(--radius-md, 8px);
		border: 1px solid var(--line, #ddd);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
		display: flex;
		flex-direction: column;
		scroll-snap-align: center;
	}

	.column-header-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 0.75rem; /* Reduced padding to prevent overflow */
		border-bottom: 1px solid var(--line, #eee);
		background: var(--bg-secondary, #fafafa);
		border-radius: 8px 8px 0 0;
		gap: 0.5rem;
	}

	.compare-column.is-base-idea {
		border: 2px solid var(--primary, #4f7df9);
		background: color-mix(in srgb, var(--primary, #4f7df9) 3%, #fff);
	}
	.compare-column.is-base-idea .column-header-row {
		background: color-mix(in srgb, var(--primary, #4f7df9) 8%, #fafafa);
		border-bottom: 2px solid color-mix(in srgb, var(--primary, #4f7df9) 20%, #eee);
	}

	.column-vote {
		transform: scale(0.9);
		transform-origin: right center;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	/* ── Proposal View ── */
	.sol-view {
		padding: 1rem;
		flex: 1;
	}

	.sol-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		margin-bottom: 0.5rem;
	}

	.sol-type-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.2rem 0.5rem;
		border-radius: 4px;
		background: var(--color-bg-tertiary, #f0f0f0);
		color: var(--color-text-secondary, #555);
		font-size: 0.7rem;
		font-weight: 600;
	}

	.sol-status-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.2rem 0.5rem;
		border-radius: 1rem;
		font-size: 0.7rem;
		font-weight: 700;
	}
	.sol-champion {
		background: color-mix(in srgb, var(--color-warning, #f1c40f) 15%, transparent);
		color: color-mix(in srgb, var(--color-warning, #f1c40f) 80%, #000);
	}

	.sol-author {
		font-size: 0.75rem;
		color: var(--color-text-muted, #888);
		margin-left: auto;
	}

	.sol-title {
		margin: 0.5rem 0;
		font-size: 1.15rem;
		font-weight: 700;
		line-height: 1.35;
		color: var(--color-text, #111);
	}

	.sol-content {
		font-size: 0.88rem;
		line-height: 1.6;
	}

	/* ── Diff Overrides ── */
	:global(.diff-rendered-content ins) {
		background-color: color-mix(in srgb, var(--color-success, #2ecc71) 25%, transparent);
		text-decoration: none;
		border-radius: 2px;
		padding: 0 2px;
	}
	:global(.diff-rendered-content del) {
		background-color: color-mix(in srgb, var(--color-danger, #e74c3c) 20%, transparent);
		text-decoration: line-through;
		color: color-mix(in srgb, var(--color-danger, #e74c3c) 80%, #000);
		border-radius: 2px;
		padding: 0 2px;
	}
	:global(.diff-rendered-content .is-modified) {
		position: relative;
		padding-left: 10px;
		margin-left: -12px;
		border-left: 3px solid var(--color-warning, #f39c12);
		background: color-mix(in srgb, var(--color-warning, #f39c12) 5%, transparent);
		border-radius: 0 4px 4px 0;
		padding-top: 2px;
		padding-bottom: 2px;
	}

	/* ── Footer ── */

	.btn-combine {
		flex: 1;
		padding: 0.55rem 0.75rem;
		background: var(--color-primary, #3b82f6);
		color: white;
		border: none;
		border-radius: var(--radius-sm, 4px);
		font-weight: 700;
		font-size: 0.82rem;
		cursor: pointer;
		transition: opacity 0.15s;
	}
	.btn-combine:hover {
		opacity: 0.85;
	}
	.btn-combine:disabled {
		background: var(--color-bg-tertiary, #e0e0e0);
		color: var(--color-text-muted, #888);
		cursor: not-allowed;
		opacity: 1;
	}

	@media (max-width: 768px) {
		.compare-column {
			flex: 0 0 85vw;
			scroll-snap-align: center;
		}
	}

	/* ── Column Selection ── */
	.column-selection {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.selection-checkbox {
		width: 1.2rem;
		height: 1.2rem;
		cursor: pointer;
	}
	.selection-badge {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.2rem 0.5rem;
		border-radius: 4px;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		white-space: nowrap;
	}
	.selection-badge.base-badge {
		background: color-mix(in srgb, var(--primary, #4f7df9) 12%, transparent);
		color: var(--primary, #4f7df9);
	}
	.selection-badge.other-badge {
		background: color-mix(in srgb, var(--text-secondary, #666) 10%, transparent);
		color: var(--text-secondary, #666);
	}
	button.selection-badge.swap-base-btn {
		cursor: pointer;
		border: none;
		transition: all 0.2s;
	}
	button.selection-badge.swap-base-btn:hover {
		filter: brightness(0.9);
		transform: scale(1.02);
	}

	/* ── Inline Editor Panel ── */
	.inline-editor-panel {
		border-top: 2px solid var(--primary, #4f7df9);
		background: var(--paper, #fff);
		padding: 1.5rem;
		box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.05);
		display: flex;
		flex-direction: column;
		gap: 1rem;
		flex-shrink: 0;
	}
	.editor-panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.editor-panel-header h3 {
		margin: 0;
		font-size: 1.2rem;
		font-weight: 700;
	}
	.header-left {
		display: flex;
		align-items: center;
		gap: 1.5rem;
	}
	.swap-base-container {
		margin-bottom: 0.5rem;
	}
	:global(.swap-action-btn) {
		color: var(--text-secondary, #555) !important;
		border-color: var(--line, #ddd) !important;
		font-weight: 600 !important;
	}
	:global(.swap-action-btn:hover) {
		color: var(--text-primary, #111) !important;
		background: var(--surface-2, #f5f5f5) !important;
	}
	.editor-panel-body {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.field-label {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-primary, #333);
	}
	.field-input,
	.field-textarea {
		padding: 0.5rem;
		border: 1px solid var(--line, #ddd);
		border-radius: 4px;
		font-size: 0.9rem;
		font-family: inherit;
	}
	.field-readonly {
		padding: 0.5rem;
		border: 1px solid var(--line, #ddd);
		border-radius: 4px;
		font-size: 0.9rem;
		background: color-mix(in srgb, var(--ink, #111) 4%, var(--paper, #fff));
		color: var(--muted, #666);
		font-family: inherit;
	}
	.field-textarea {
		resize: vertical;
		min-height: 3rem;
	}
	.editor-wysiwyg-wrap {
		min-height: 10rem;
		border: 1px solid var(--line, #ddd);
		border-radius: 4px;
	}
	.editor-panel-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 1rem;
	}
	.error-msg {
		color: var(--color-danger, #e74c3c);
		font-size: 0.85rem;
		margin: 0;
	}

	.combine-action-bar {
		padding: 1rem;
		display: flex;
		justify-content: center;
		background: var(--color-bg-primary, #fff);
		border-top: 1px solid var(--line, #ddd);
		flex-shrink: 0;
		position: sticky;
		bottom: 0;
		z-index: var(--z-dropdown);
		box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.05);
	}

	@keyframes fly-across {
		0% {
			transform: translate(0, -50%) scale(1);
			opacity: 1;
		}
		50% {
			transform: translate(30px, -70%) scale(1.2);
			opacity: 1;
		}
		100% {
			transform: translate(60px, -50%) scale(0);
			opacity: 0;
		}
	}

	.compare-column.selected {
		border: 2px solid var(--primary, #4f7df9);
		box-shadow: 0 4px 12px rgba(79, 125, 249, 0.15);
	}

	.jump-link {
		color: var(--text-muted, #888);
		margin-left: 0.5rem;
		display: inline-flex;
		align-items: center;
		opacity: 0.6;
		transition: all 0.2s;
		position: relative;
		z-index: var(--z-max);
		pointer-events: auto;
	}
	.jump-link:hover {
		color: var(--primary, #4f7df9);
		opacity: 1;
	}
</style>
