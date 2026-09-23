<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import { Placeholder } from '@tiptap/extension-placeholder';
	import { createToolbarButtons } from '$lib/components/wysiwyg-toolbar';
	import * as m from '$lib/paraglide/messages.js';

	let {
		html = $bindable(''),
		name = '',
		label = '',
		emptyText = '',
		placeholder = 'Write your content...',
		editable = true,
		ariaLabel = 'Rich text editor'
	}: {
		html?: string;
		name?: string;
		label?: string;
		emptyText?: string;
		placeholder?: string;
		editable?: boolean;
		ariaLabel?: string;
	} = $props();

	let editor: Editor | null = null;
	let editorEl = $state<HTMLDivElement | null>(null);
	let toolbarVersion = $state(0);
	let lastAppliedExternalHtml = '';

	function stripHtmlTags(value: string): string {
		return value
			.replaceAll(/<[^>]+>/g, ' ')
			.replaceAll(/&nbsp;/g, ' ')
			.replaceAll(/&(?:amp|lt|gt|quot|#39);/g, ' ')
			.replaceAll(/\s+/g, ' ')
			.trim();
	}

	function normalizeHtml(value: string | undefined): string {
		const normalized = typeof value === 'string' ? value : '';
		return stripHtmlTags(normalized).length === 0 ? '' : normalized;
	}

	const hasContent = $derived(stripHtmlTags(normalizeHtml(html)).length > 0);
	const showEditor = $derived(editable || hasContent || !emptyText);

	const toolbarButtons = createToolbarButtons(() => editor);

	function getEditorHtml(): string {
		if (!editor) {
			return normalizeHtml(html);
		}

		return normalizeHtml(editor.getHTML());
	}

	onMount(() => {
		if (!editorEl || !showEditor) {
			return;
		}

		lastAppliedExternalHtml = normalizeHtml(html);

		editor = new Editor({
			element: editorEl,
			editable,
			content: lastAppliedExternalHtml,
			extensions: [StarterKit, Placeholder.configure({ placeholder })],
			onUpdate: () => {
				const nextHtml = getEditorHtml();
				if (html !== nextHtml) {
					html = nextHtml;
				}
				lastAppliedExternalHtml = nextHtml;
				if (editable) {
					toolbarVersion += 1;
				}
			},
			onTransaction: () => {
				if (editable) {
					toolbarVersion += 1;
				}
			}
		});
	});

	onDestroy(() => {
		editor?.destroy();
		editor = null;
	});

	$effect(() => {
		if (!editor) {
			return;
		}

		if (editor.isEditable !== editable) {
			editor.setEditable(editable);
		}
	});

	$effect(() => {
		if (!editor) {
			return;
		}

		const incomingHtml = normalizeHtml(html);
		if (incomingHtml === lastAppliedExternalHtml) {
			return;
		}

		// Avoid feedback loops: when syncing from external state, don't emit onUpdate.
		lastAppliedExternalHtml = incomingHtml;
		editor.commands.setContent(incomingHtml, { emitUpdate: false });
	});
</script>

<div class="stack" style="gap:0.3rem;">
	{#if label}
		<span>{label}</span>
	{/if}

	{#if showEditor}
		<div class="wysiwyg-wrap">
			{#if editable}
				<div
					class="toolbar"
					role="toolbar"
					aria-label={m.editor_toolbar_aria()}
					data-version={toolbarVersion}
				>
					{#each toolbarButtons as button (button.label)}
						<button
							type="button"
							class="toolbar-btn"
							title={button.title}
							onclick={button.action}
							class:active={button.isActive()}
						>
							{button.label}
						</button>
					{/each}
				</div>
			{/if}

			<div
				bind:this={editorEl}
				class="editor-shell"
				class:readonly={!editable}
				role="textbox"
				aria-label={ariaLabel}
				aria-multiline="true"
			></div>
		</div>
	{:else}
		<p class="muted" style="margin:0;">{emptyText}</p>
	{/if}

	{#if name}
		<input type="hidden" {name} value={html} />
	{/if}
</div>

<style>
	.wysiwyg-wrap {
		display: grid;
		gap: 0.5rem;
	}

	.toolbar {
		display: flex;
		gap: 0.35rem;
		flex-wrap: wrap;
		padding: 0.35rem;
		border: 1px solid var(--line);
		border-radius: 0.7rem;
		background: white;
	}

	.toolbar-btn {
		border: 1px solid var(--line);
		background: white;
		color: var(--ink);
		padding: 0.22rem 0.5rem;
		border-radius: 0.45rem;
		font-size: 0.78rem;
		font-weight: 700;
		cursor: pointer;
	}

	.toolbar-btn.active {
		border-color: var(--ink);
		background: var(--ink);
		color: white;
	}

	.editor-shell {
		min-height: 12rem;
		padding: 0.75rem 0.8rem;
		border: 1px solid var(--line);
		border-radius: 0.8rem;
		background: white;
	}

	.editor-shell:focus-within {
		border-color: color-mix(in srgb, var(--brand) 45%, var(--line));
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 12%, transparent);
	}

	.editor-shell.readonly {
		min-height: 0;
		padding: 0;
		border: none;
		background: transparent;
	}

	:global(.editor-shell .ProseMirror) {
		outline: none;
		white-space: pre-wrap;
		line-height: 1.6;
	}

	:global(.editor-shell .ProseMirror p.is-editor-empty:first-child::before) {
		content: attr(data-placeholder);
		float: left;
		color: var(--muted);
		pointer-events: none;
		height: 0;
	}

	:global(.editor-shell .ProseMirror h1),
	:global(.editor-shell .ProseMirror h2),
	:global(.editor-shell .ProseMirror h3) {
		line-height: 1.2;
		margin: 0.8rem 0 0.4rem;
		font-weight: 700;
	}

	:global(.editor-shell .ProseMirror h1) {
		font-size: 1.3rem;
	}

	:global(.editor-shell .ProseMirror h2) {
		font-size: 1.15rem;
	}

	:global(.editor-shell .ProseMirror h3) {
		font-size: 1rem;
	}

	:global(.editor-shell .ProseMirror p),
	:global(.editor-shell .ProseMirror ul),
	:global(.editor-shell .ProseMirror ol),
	:global(.editor-shell .ProseMirror blockquote) {
		margin: 0.55rem 0;
	}

	:global(.editor-shell .ProseMirror ul) {
		list-style: disc;
		padding-left: 1.35rem;
	}

	:global(.editor-shell .ProseMirror ol) {
		list-style: decimal;
		padding-left: 1.35rem;
	}

	:global(.editor-shell .ProseMirror li) {
		margin: 0.2rem 0;
	}

	:global(.editor-shell .ProseMirror blockquote) {
		border-left: 3px solid var(--line);
		padding-left: 0.75rem;
		color: var(--muted);
	}

	:global(.editor-shell .ProseMirror pre) {
		margin: 0.7rem 0;
		padding: 0.55rem 0.7rem;
		background: color-mix(in srgb, var(--line) 18%, white);
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		overflow-x: auto;
	}

	:global(.editor-shell .ProseMirror pre code) {
		font-family:
			ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
			monospace;
		font-size: 0.9em;
	}
</style>
