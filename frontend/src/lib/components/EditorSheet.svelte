<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { goto, invalidate } from '$app/navigation';
	import { deserialize } from '$app/forms';
	import { localizePath } from '$lib/utils/i18n-path';
	import { editorState } from '$lib/editor.svelte';
	import { feedViewState } from '$lib/feedView.svelte';
	import WysiwygMarkdownEditor from '$lib/components/WysiwygMarkdownEditor.svelte';
	import ContentDiffView from '$lib/components/ContentDiffView.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { X, Lightbulb, AlertTriangle, MessageSquare } from '@lucide/svelte';

	interface Props {
		questionId: string;
		user: { id: string; name?: string } | null;
		labels?: App.LabelRecord[];
	}

	let { questionId, user, labels = [] }: Props = $props();

	// ── Form state ─────────────────────────────────────────────────────
	let title = $state('');
	let content = $state('');
	let rationale = $state('');
	let labelStr = $state('');
	let activeWorkspaceTab = $state<'edit' | 'diff' | 'reference'>('edit');
	let isSubmitting = $state(false);
	let errorMessage = $state('');

	// Track when mode changes to reset form
	let lastModeKey = $state('');
	let hasManuallyEditedLabel = $state(false);

	$effect(() => {
		const key = `${editorState.phase}:${editorState.parentA?.id ?? ''}:${editorState.parentB?.id ?? ''}`;
		if (key !== lastModeKey) {
			lastModeKey = key;
			activeWorkspaceTab = 'edit';
			errorMessage = '';
			isSubmitting = false;
			hasManuallyEditedLabel = false;

			if (editorState.phase === 'improve' && editorState.parentA) {
				title = editorState.parentA.title;
				content = editorState.parentA.content;
				rationale = '';
				// Note: if remixing, the backend automatically inherits the parent's primary_label
				labelStr = '';
			}
		}
	});

	// Auto-fill label based on title if not manually edited (only in combine mode)
	$effect(() => {
		if (editorState.phase === 'combine' && !hasManuallyEditedLabel && title) {
			labelStr = title.substring(0, 40);
		}
	});

	// ── Dynamic header ────────────────────────────────────────────────
	const headerTitle = $derived.by(() => {
		if (editorState.phase === 'improve' && editorState.parentA) {
			return m.editor_header_remix_idea();
		}
		if (editorState.phase === 'combine') {
			return m.editor_header_remix_ideas();
		}
		return '';
	});

	// ── Validation ─────────────────────────────────────────────────────
	const isValid = $derived.by(() => {
		if (title.trim().length === 0) return false;
		if (content.trim().length === 0) return false;
		if (rationale.trim().length === 0) return false;
		return true;
	});

	// ── Base content for diff ──
	const diffBaseHtml = $derived(editorState.parentA?.content ?? '');

	// ── Soft diff warning: detect nearly-empty changes ──
	const diffPercent = $derived.by(() => {
		const base = diffBaseHtml.replace(/<[^>]*>/g, '');
		const current = content.replace(/<[^>]*>/g, '');
		if (base.length === 0) return current.length > 0 ? 100 : 0;
		let diffs = 0;
		const maxLen = Math.max(base.length, current.length);
		for (let i = 0; i < maxLen; i++) {
			if (base[i] !== current[i]) diffs++;
		}
		return Math.round((diffs / maxLen) * 100);
	});

	// ── Submission ─────────────────────────────────────────────────────
	export const handleSubmit = async () => {
		if (!isValid || isSubmitting || !user) return;
		isSubmitting = true;
		errorMessage = '';

		const parentIds: string[] = [];
		if (editorState.phase === 'improve' && editorState.parentA) {
			parentIds.push(editorState.parentA.id);
		}

		const formData = new FormData();
		formData.append('title', title.trim());
		formData.append('content', content);
		if (labelStr.trim()) {
			formData.append('label', labelStr.trim());
		}
		formData.append('reason_for_change', rationale);
		for (const pid of parentIds) {
			formData.append('parent_ids', pid);
		}
		if (editorState.phase === 'improve' && editorState.parentA) {
			formData.append('base_parent', editorState.parentA.id);
		}

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
				// @ts-ignore
				const result = deserialize(text);

				if (result.type === 'success') {
					newProposalId = (result.data?.id as string) ?? null;
				} else if (result.type === 'failure') {
					errorMessage = (result.data?.message as string) || m.editor_error_publish_failed();
					isSubmitting = false;
					return;
				} else if (result.type === 'error') {
					errorMessage = m.editor_error_generic();
					isSubmitting = false;
					return;
				}
			} catch {
				// Fallback if parsing fails
				errorMessage = m.editor_error_network();
				isSubmitting = false;
				return;
			}

			// Invalidate layout data BEFORE navigation so SvelteKit's preloadData fetches fresh data,
			// and so we don't wipe the history state of the newly pushed shallow route.
			await invalidate('app:proposals').catch(() => {});

			// Navigate
			if (newProposalId) {
				await goto(localizePath(`/questions/${questionId}/proposals/${newProposalId}`)).catch(
					() => {}
				);
			} else {
				await goto(localizePath(`/questions/${questionId}/proposals/ballot`)).catch(() => {});
			}

			// Finally close editor
			editorState.close();
			isSubmitting = false;
		} catch (err) {
			console.error('[EditorSheet] submission error', err);
			errorMessage = m.editor_error_network();
			isSubmitting = false;
		}
	};

	// ── Rationale label (mode-specific) ───────────────────────────────
	const rationaleLabel = m.editor_rationale_label();
	const rationalePlaceholder = m.editor_rationale_placeholder();

	// ── Title editability (iteration = readonly, synthesis = editable) ─
	const isTitleReadonly = $derived(editorState.phase === 'improve');

	// ── Contribution Intents ──────────────────────────────────────────
	const improveIntents = $derived([
		m.intent_fix_logic(),
		m.intent_restructure_clarity(),
		m.intent_add_context(),
		m.intent_new_direction(),
		m.intent_add_assumption(),
		m.intent_critique_assumption()
	]);
	const combineIntents = $derived([
		m.intent_synthesize_ideas(),
		m.intent_resolve_tensions(),
		m.intent_find_compromise()
	]);

	const currentIntents = $derived.by(() => {
		if (editorState.phase === 'combine') return combineIntents;
		return improveIntents;
	});

	function applyIntent(intent: string) {
		if (rationale.length > 0 && !rationale.endsWith(' ')) {
			rationale += ', ';
		}
		rationale += intent;
	}

	// ── Expose for parent (layout → TabBar via bind:this) ────────────
	export { headerTitle, isValid, isSubmitting };
</script>

<!-- Inline editor content — replaces panel children when open -->
<div class="editor-inline">
	<header class="editor-header">
		<h3 class="editor-title">{headerTitle}</h3>
		<button
			type="button"
			class="close-editor-btn"
			onclick={() => editorState.close()}
			aria-label={m.editor_close_aria()}
		>
			<X size={18} />
		</button>
	</header>

	<!-- Editor body -->
	<div class="editor-body">
		<!-- Contextual Metadata Zone -->

		{#if editorState.phase === 'improve'}
			<!-- Tabbed Workspace -->
			<div class="workspace-tabs">
				<button
					type="button"
					class="tab-btn"
					class:active={activeWorkspaceTab === 'edit'}
					onclick={() => (activeWorkspaceTab = 'edit')}
				>
					{m.editor_tab_edit()}
				</button>
				<button
					type="button"
					class="tab-btn"
					class:active={activeWorkspaceTab === 'diff'}
					onclick={() => (activeWorkspaceTab = 'diff')}
				>
					{m.editor_tab_diff()}
				</button>
				<button
					type="button"
					class="tab-btn"
					class:active={activeWorkspaceTab === 'reference'}
					onclick={() => (activeWorkspaceTab = 'reference')}
				>
					{m.editor_tab_reference()}
				</button>
			</div>
		{/if}

		<!-- Tab Content -->
		<div class="workspace-content">
			{#if activeWorkspaceTab === 'edit'}
				<!-- Title field -->
				<div class="field">
					<label class="field-label" for="editor-title">{m.editor_sheet_title()}</label>
					{#if isTitleReadonly}
						<div class="field-readonly">{title}</div>
					{:else}
						<input
							id="editor-title"
							class="field-input"
							bind:value={title}
							maxlength="120"
							placeholder={m.editor_sheet_title_placeholder()}
						/>
					{/if}
				</div>

				{#if editorState.parentB}
					<div class="field">
						<label class="field-label" for="editor-label">{m.editor_label_optional()}</label>
						<input
							id="editor-label"
							class="field-input"
							bind:value={labelStr}
							oninput={() => (hasManuallyEditedLabel = true)}
							maxlength="40"
							placeholder={m.editor_label_placeholder()}
						/>
						<p class="field-hint">{m.editor_label_hint()}</p>
					</div>
				{:else if editorState.phase === 'improve'}
					<div class="field">
						<label class="field-label" for="editor-label">{m.editor_label()}</label>
						<div
							class="field-readonly"
							style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;"
						>
							<span style="color: var(--muted, #666);">{m.editor_label_inherited()}</span>
							{#each editorState.parentA?.labels || [] as labelId}
								{@const l = labels.find((lbl) => lbl.id === labelId)}
								{#if l}
									<Badge label={l.short_name} color={l.color} theme="custom" shape="pill" />
								{/if}
							{/each}
						</div>
					</div>
				{/if}

				<!-- Content (WYSIWYG) -->
				<div class="field">
					<div class="field-label-row">
						<span class="field-label">{m.editor_sheet_content()}</span>
					</div>
					<div class="editor-wysiwyg-wrap">
						<WysiwygMarkdownEditor
							name="content"
							bind:html={content}
							placeholder={m.editor_sheet_description_placeholder()}
							ariaLabel={m.editor_content_aria()}
						/>
					</div>
				</div>

				<!-- Description / Rationale — below content, only for iteration & synthesis -->
				{#if diffPercent < 5}
					<div class="diff-warning">
						<AlertTriangle size={14} class="inline-icon" />
						{m.editor_diff_warning({ percent: String(diffPercent) })}
					</div>
				{/if}

				<div class="field">
					<div class="field-label-row">
						<label class="field-label" for="editor-rationale">{rationaleLabel}</label>
						<div class="intent-chips">
							{#each currentIntents as intent}
								<button type="button" class="intent-chip" onclick={() => applyIntent(intent)}>
									{intent}
								</button>
							{/each}
						</div>
					</div>
					<textarea
						id="editor-rationale"
						class="field-textarea"
						bind:value={rationale}
						placeholder={rationalePlaceholder}
						rows="2"
					></textarea>
				</div>
			{:else if activeWorkspaceTab === 'diff'}
				<ContentDiffView baseHtml={diffBaseHtml} currentHtml={content} />
			{:else if activeWorkspaceTab === 'reference'}
				<div class="reference-view">
					{#if editorState.parentA}
						<div class="reference-card">
							<span class="ref-label">{m.editor_sheet_original()}</span>
							<h4 class="ref-title">{editorState.parentA.title}</h4>
							<div
								class="ref-labels"
								style="display: flex; gap: 0.25rem; margin-bottom: 0.5rem; flex-wrap: wrap;"
							>
								{#each editorState.parentA?.labels || [] as labelId}
									{@const l = labels.find((lbl) => lbl.id === labelId)}
									{#if l}
										<Badge label={l.short_name} color={l.color} theme="custom" shape="pill" />
									{/if}
								{/each}
							</div>
							<div class="ref-content">
								<WysiwygMarkdownEditor html={editorState.parentA.content} editable={false} />
							</div>
						</div>
					{/if}

					{#if editorState.parentFeedback.length > 0}
						<div class="feedback-panel">
							<span class="ref-label">{m.editor_sheet_feedback()}</span>
							<div class="feedback-list">
								{#each editorState.parentFeedback as fb}
									<div class="feedback-item">
										<span class="feedback-icon"><MessageSquare size={14} /></span>
										<div class="feedback-body">
											<span class="feedback-text"
												>{fb.content.replace(/<[^>]*>/g, '').slice(0, 200)}</span
											>
											<span class="feedback-meta">
												{fb.author_name}
												{#if fb.upvote_count > 0}· ▲ {fb.upvote_count}{/if}
												· {m.editor_feedback_on({ title: fb.parent_proposal_title })}
											</span>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Error display -->
		{#if errorMessage}
			<p class="error-msg">{errorMessage}</p>
		{/if}
	</div>

	<div class="editor-actions">
		<button type="button" class="cancel-btn" onclick={() => editorState.close()}>
			{m.common_cancel()}
		</button>
		<button
			type="button"
			class="publish-btn"
			disabled={!isValid || isSubmitting}
			onclick={handleSubmit}
		>
			{isSubmitting ? m.editor_publishing() : m.editor_publish()}
		</button>
	</div>
</div>

<style>
	/* ── Container ──────────────────────────────────────────────── */
	.editor-inline {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}

	/* ── Body ───────────────────────────────────────────────────── */
	.editor-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-height: 0;
		overflow-y: auto;
		padding: 1rem;
		padding-bottom: 2rem;
	}

	/* ── Fields ─────────────────────────────────────────────────── */
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.field-label {
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--ink, #333);
	}

	.field-label-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 0.2rem;
	}

	.field-hint {
		margin: 0;
		font-size: 0.72rem;
		color: var(--muted, #666);
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

	.field-input {
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--line, #ddd);
		border-radius: 5px;
		font-size: 0.85rem;
		background: var(--paper, #fff);
		color: var(--ink, #111);
		font-family: inherit;
	}

	.field-input:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--brand, #4f46e5) 50%, var(--line, #ddd));
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand, #4f46e5) 12%, transparent);
	}

	.field-readonly {
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--line, #ddd);
		border-radius: 5px;
		font-size: 0.85rem;
		background: color-mix(in srgb, var(--ink, #111) 4%, var(--paper, #fff));
		color: var(--muted, #666);
		font-family: inherit;
	}

	.field-textarea {
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--line, #ddd);
		border-radius: 5px;
		font-size: 0.85rem;
		background: var(--paper, #fff);
		color: var(--ink, #111);
		font-family: inherit;
		resize: vertical;
		min-height: 2.5rem;
	}

	.field-textarea:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--brand, #4f46e5) 50%, var(--line, #ddd));
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand, #4f46e5) 12%, transparent);
	}

	.editor-wysiwyg-wrap {
		min-height: 10rem;
	}

	.editor-wysiwyg-wrap :global(.editor-shell) {
		min-height: 10rem;
	}

	/* ── Merge callout ───────────────────────────────────────────── */

	/* ── Base parent selector ───────────────────────────────────── */

	/* ── Workspace tabs ─────────────────────────────────────────── */
	.workspace-tabs {
		display: flex;
		gap: 0;
		background: color-mix(in srgb, var(--ink, #111) 5%, var(--paper, #fff));
		border-radius: 6px;
		padding: 2px;
		flex-shrink: 0;
	}

	.workspace-tabs .tab-btn {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.4rem 0.5rem;
		border: none;
		background: transparent;
		color: var(--muted, #888);
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		border-radius: 4px;
		transition: all 0.15s ease;
		white-space: nowrap;
	}

	.workspace-tabs .tab-btn:hover {
		color: var(--ink, #111);
	}

	.workspace-tabs .tab-btn.active {
		background: var(--paper, #fff);
		color: var(--ink, #111);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
	}

	.workspace-content {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		min-height: 0;
	}

	/* ── Reference view ─────────────────────────────────────────── */
	.reference-view {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.reference-card {
		border: 1px solid var(--line, #ddd);
		border-radius: 6px;
		padding: 0.75rem;
		background: color-mix(in srgb, var(--ink, #111) 3%, var(--paper, #fff));
	}

	.ref-label {
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted, #888);
	}

	.ref-title {
		margin: 0.25rem 0 0.5rem;
		font-size: 0.92rem;
	}

	.ref-content {
		max-height: 200px;
		overflow-y: auto;
		font-size: 0.85rem;
	}

	/* ── Error ──────────────────────────────────────────────────── */
	.error-msg {
		margin: 0;
		font-size: 0.78rem;
		color: #a03b2f;
		padding: 0.4rem 0.55rem;
		background: color-mix(in srgb, #a03b2f 8%, var(--paper, #fff));
		border-radius: 4px;
		border: 1px solid color-mix(in srgb, #a03b2f 20%, var(--line, #ddd));
	}
	/* ── Diff warning ──────────────────────────────────────────── */
	.diff-warning {
		font-size: 0.8rem;
		font-weight: 500;
		padding: 0.5rem 0.65rem;
		background: color-mix(in srgb, #f59e0b 10%, var(--paper, #fff));
		border: 1px solid color-mix(in srgb, #f59e0b 30%, var(--line, #ddd));
		border-left: 3px solid #f59e0b;
		border-radius: 4px;
		color: #92400e;
		line-height: 1.4;
	}

	/* ── Community Feedback panel ──────────────────────────────── */
	.feedback-panel {
		border: 1px solid color-mix(in srgb, #f59e0b 30%, var(--line, #ddd));
		border-radius: 6px;
		padding: 0.6rem 0.75rem;
		background: color-mix(in srgb, #f59e0b 4%, var(--paper, #fff));
	}

	.feedback-list {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-top: 0.35rem;
	}

	.feedback-item {
		display: flex;
		gap: 0.3rem;
		align-items: flex-start;
		padding: 0.25rem 0;
		border-bottom: 1px solid color-mix(in srgb, var(--line, #ddd) 50%, transparent);
	}

	.feedback-item:last-child {
		border-bottom: none;
	}

	.feedback-icon {
		flex-shrink: 0;
		font-size: 0.72rem;
	}

	.feedback-body {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}

	.feedback-text {
		font-size: 0.78rem;
		color: var(--ink, #222);
		line-height: 1.4;
	}

	.feedback-meta {
		font-size: 0.65rem;
		color: var(--muted, #888);
	}

	/* ── Editor Header & Actions Styles ── */
	.editor-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--line, #ddd);
		background: var(--paper, #fff);
		flex-shrink: 0;
	}

	.editor-title {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
		color: var(--ink, #111);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.close-editor-btn {
		background: none;
		border: none;
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--muted, #888);
		cursor: pointer;
		padding: 0.25rem;
		border-radius: 4px;
		line-height: 1;
		transition: all 0.12s;
	}

	.close-editor-btn:hover {
		color: var(--ink, #111);
		background: color-mix(in srgb, var(--ink, #111) 6%, transparent);
	}

	.editor-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border-top: 1px solid var(--line, #ddd);
		background: var(--paper, #fff);
		flex-shrink: 0;
	}

	.cancel-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.55rem 1rem;
		min-height: var(--touch-min, 40px);
		background: transparent;
		color: var(--ink, #111);
		font-weight: 600;
		font-size: 0.85rem;
		border: 1px solid var(--line, #ddd);
		border-radius: 6px;
		cursor: pointer;
		transition: background 0.12s;
	}

	.cancel-btn:hover {
		background: color-mix(in srgb, var(--ink, #111) 5%, white);
	}

	.publish-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.55rem 1.25rem;
		min-height: var(--touch-min, 40px);
		background: var(--ink, #111);
		color: var(--paper, #fff);
		font-weight: 700;
		font-size: 0.85rem;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.publish-btn:hover {
		opacity: 0.85;
	}

	.publish-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
</style>
