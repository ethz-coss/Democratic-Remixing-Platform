<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import WysiwygMarkdownEditor from '$lib/components/WysiwygMarkdownEditor.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { Lightbulb } from '@lucide/svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let title = $state('');
	let content = $state('');
	let labelStr = $state('');
	let isSubmitting = $state(false);

	let hasManuallyEditedLabel = $state(false);

	const storageKey = $derived(`remix-new-idea-${data.question.id}`);

	// Load draft from localStorage on mount
	$effect(() => {
		if (typeof window !== 'undefined') {
			const draft = localStorage.getItem(storageKey);
			if (draft) {
				try {
					const parsed = JSON.parse(draft);
					if (parsed.title) title = parsed.title;
					if (parsed.content) content = parsed.content;
					if (parsed.labelStr) {
						labelStr = parsed.labelStr;
						hasManuallyEditedLabel = parsed.hasManuallyEditedLabel;
					}
				} catch (e) {
					console.error('Failed to parse draft', e);
				}
			}
		}
	});

	// Save draft to localStorage when data changes
	$effect(() => {
		const timer = setTimeout(() => {
			if (!isSubmitting) {
				if (title || content || labelStr) {
					localStorage.setItem(
						storageKey,
						JSON.stringify({ title, content, labelStr, hasManuallyEditedLabel })
					);
				} else {
					localStorage.removeItem(storageKey);
				}
			}
		}, 500);
		return () => clearTimeout(timer);
	});

	// Auto-fill label based on title if not manually edited
	$effect(() => {
		if (!hasManuallyEditedLabel && title) {
			labelStr = title.substring(0, 40);
		}
	});

	const handleLabelInput = () => {
		hasManuallyEditedLabel = true;
	};

	const isValid = $derived(title.trim().length > 0 && content.trim().length > 4);
</script>

<div class="new-idea-page">
	<div class="page-header">
		<h2>{m.new_idea_page_title()}</h2>
		<p class="header-subtitle">{m.new_idea_page_subtitle()}</p>
	</div>

	<div class="new-idea-warning">
		<span class="warning-icon"><Lightbulb size={18} /></span>
		<div class="warning-body">
			<strong class="warning-title">{m.new_idea_warning_title()}</strong>
			<p class="warning-text">
				{m.new_idea_warning_text()}
			</p>
		</div>
	</div>

	<form
		method="POST"
		class="editor-body"
		use:enhance={() => {
			isSubmitting = true;
			return async ({ update, result }) => {
				if (result.type === 'redirect' || (result.type === 'success' && result.data?.success)) {
					localStorage.removeItem(storageKey);
					title = '';
					content = '';
					labelStr = '';
					hasManuallyEditedLabel = false;
				}
				await update();
				isSubmitting = false;
			};
		}}
	>
		<!-- Title field -->
		<div class="field">
			<label class="field-label" for="editor-title">
				{m.editor_sheet_title()}
			</label>
			<input
				id="editor-title"
				name="title"
				class="field-input"
				bind:value={title}
				maxlength="120"
				placeholder={m.new_idea_title_placeholder()}
				required
			/>
		</div>

		<!-- Label field -->
		<div class="field">
			<div class="field-label-row">
				<label class="field-label" for="editor-label">{m.editor_label()}</label>
				<span
					class="char-count"
					class:near-limit={labelStr.length > 30}
					class:at-limit={labelStr.length >= 40}
				>
					({labelStr.length}/40)
				</span>
			</div>
			<input
				id="editor-label"
				name="label"
				class="field-input"
				bind:value={labelStr}
				oninput={handleLabelInput}
				maxlength="40"
				placeholder={m.new_idea_label_placeholder()}
			/>
			<p class="field-hint">{m.new_idea_label_hint()}</p>
		</div>

		<!-- Content (WYSIWYG) -->
		<div class="field">
			<div class="field-label-row">
				<span class="field-label">{m.editor_sheet_content()}</span>
			</div>
			<div class="editor-wysiwyg-wrap">
				<WysiwygMarkdownEditor
					name="content"
					bind:html={content}
					placeholder={m.new_idea_content_placeholder()}
					ariaLabel={m.new_idea_content_aria()}
				/>
			</div>
		</div>

		{#if form?.message}
			<p class="error-msg">{form.message}</p>
		{/if}

		<div class="editor-actions">
			<button type="submit" class="publish-btn" disabled={!isValid || isSubmitting}>
				{isSubmitting ? m.editor_publishing() : m.new_idea_publish_btn()}
			</button>
		</div>
	</form>
</div>

<style>
	.new-idea-page {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow-y: auto;
		background: var(--bg, #f9fafb);
	}

	.page-header {
		padding: 1.5rem 1.5rem 0.5rem;
	}

	.page-header h2 {
		margin: 0 0 0.25rem 0;
		font-size: 1.25rem;
		color: var(--ink, #111);
	}

	.header-subtitle {
		margin: 0;
		font-size: 0.85rem;
		color: var(--muted, #666);
	}

	.editor-body {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		padding: 1rem 1.5rem 4rem; /* Bottom padding to ensure content is visible above bottom bar */
	}

	.new-idea-warning {
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
		margin: 0 1.5rem 0.5rem;
		padding: 0.75rem 1rem;
		background: color-mix(in srgb, var(--brand, #4f46e5) 8%, var(--paper, #fff));
		border: 1px solid color-mix(in srgb, var(--brand, #4f46e5) 20%, transparent);
		border-radius: 8px;
	}

	.warning-icon {
		color: var(--brand, #4f46e5);
		margin-top: 0.1rem;
	}

	.warning-title {
		display: block;
		font-size: 0.85rem;
		color: var(--ink, #111);
		margin-bottom: 0.2rem;
	}

	.warning-text {
		margin: 0;
		font-size: 0.8rem;
		color: var(--muted, #555);
		line-height: 1.4;
	}

	/* Fields */
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.field-label-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.field-label {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--ink, #333);
	}

	.char-count {
		font-size: 0.75rem;
		color: var(--muted, #888);
		transition: color 0.2s;
	}
	.char-count.near-limit {
		color: #eab308; /* Yellow */
	}
	.char-count.at-limit {
		color: #ef4444; /* Red */
		font-weight: bold;
	}

	.field-input {
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--line, #ddd);
		border-radius: 6px;
		font-size: 0.95rem;
		background: var(--paper, #fff);
		color: var(--ink, #111);
		font-family: inherit;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}

	.field-input:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--brand, #4f46e5) 50%, var(--line, #ddd));
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand, #4f46e5) 15%, transparent);
	}

	.field-hint {
		margin: 0;
		font-size: 0.75rem;
		color: var(--muted, #666);
	}

	.editor-wysiwyg-wrap {
		min-height: 12rem;
		border-radius: 6px;
		overflow: hidden;
		border: 1px solid var(--line, #ddd);
	}
	.editor-wysiwyg-wrap :global(.editor-shell) {
		border: none !important;
	}

	.editor-actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 1rem;
	}

	.publish-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.65rem 1.5rem;
		background: var(--ink, #111);
		color: var(--paper, #fff);
		font-weight: 600;
		font-size: 0.95rem;
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

	.error-msg {
		margin: 0;
		font-size: 0.85rem;
		color: #b91c1c;
		padding: 0.75rem;
		background: #fef2f2;
		border: 1px solid #f87171;
		border-radius: 6px;
	}
</style>
