<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import WysiwygMarkdownEditor from '$lib/components/WysiwygMarkdownEditor.svelte';
	import { Drawer } from 'vaul-svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { X } from '@lucide/svelte';

	interface Props {
		open: boolean;
		onClose: () => void;
		question: App.QuestionRecord;
	}

	let { open, onClose, question }: Props = $props();

	function handleOpenChange(isOpen: boolean) {
		if (!isOpen) {
			onClose();
		}
	}
</script>

<Drawer.Root direction="top" {open} onOpenChange={handleOpenChange}>
	<Drawer.Portal>
		<Drawer.Overlay class="panel-backdrop" />
		<Drawer.Content class="question-context-panel" aria-label="Question guidelines">
			<div class="panel-header">
				<Drawer.Title class="panel-title">{m.question_description_and_constraints()}</Drawer.Title>
				<Button variant="icon" class="panel-close" onclick={onClose} aria-label={m.common_close()}>
					<X size={18} />
				</Button>
			</div>

			<div class="panel-content" data-vaul-no-drag>
				<h2 class="question-title-heading">{question.title}</h2>

				<!-- Section 1: Full Description -->
				<div class="panel-section">
					<h3 class="section-title">{m.question_description()}</h3>
					{#if question.description}
						<div class="description-wrap">
							<WysiwygMarkdownEditor
								html={question.description}
								editable={false}
								emptyText={m.question_no_description()}
							/>
						</div>
					{:else}
						<p class="empty-text">{m.question_no_description()}</p>
					{/if}
				</div>

				<!-- Section 2: Constraints checklist -->
				<div class="panel-section">
					<h3 class="section-title">{m.question_constraints()}</h3>
					<p class="constraints-intro">Every proposed solution should satisfy these constraints.</p>
					{#if question.constraints && question.constraints.length > 0}
						<ul class="constraints-list">
							{#each question.constraints as constraint, idx (idx)}
								<li class="constraint-item">
									<span class="constraint-number">{idx + 1}.</span>
									<span class="constraint-text">{constraint}</span>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="empty-text">{m.question_no_constraints()}</p>
					{/if}
				</div>
			</div>

			<!-- Pull handle for affordance (sticky at bottom) -->
			<div class="drawer-handle-container">
				<div class="drawer-handle"></div>
			</div>
		</Drawer.Content>
	</Drawer.Portal>
</Drawer.Root>

<style>
	:global(.panel-backdrop) {
		position: fixed;
		inset: 0;
		z-index: var(--z-dropdown);
		background: rgba(0, 0, 0, 0.35);
	}
	:global(.panel-backdrop[data-state='open']) {
		animation: vaul-fade-in 0.3s cubic-bezier(0.32, 0.72, 0, 1);
	}
	:global(.panel-backdrop[data-state='closed']) {
		animation: vaul-fade-out 0.3s cubic-bezier(0.32, 0.72, 0, 1);
	}

	:global(.question-context-panel) {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 101;
		max-height: 90dvh;
		background: var(--paper, #fff);
		border-bottom: 1px solid var(--line, #ddd);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
		display: flex;
		flex-direction: column;
		outline: none;
		transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1);
	}
	:global(.question-context-panel[data-state='open']) {
		animation: vaul-slide-down 0.3s cubic-bezier(0.32, 0.72, 0, 1);
	}
	:global(.question-context-panel[data-state='closed']) {
		animation: vaul-slide-up 0.3s cubic-bezier(0.32, 0.72, 0, 1);
	}

	@keyframes vaul-slide-down {
		from {
			transform: translateY(-100%);
		}
		to {
			transform: translateY(0);
		}
	}
	@keyframes vaul-slide-up {
		from {
			transform: translateY(0);
		}
		to {
			transform: translateY(-100%);
		}
	}
	@keyframes vaul-fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	@keyframes vaul-fade-out {
		from {
			opacity: 1;
		}
		to {
			opacity: 0;
		}
	}

	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: var(--top-bar-h, 44px);
		padding: 0 0.75rem;
		border-bottom: 1px solid var(--line, #ddd);
		flex-shrink: 0;
		gap: 0.5rem;
		max-width: 640px;
		margin: 0 auto;
		width: 100%;
	}

	:global(.panel-title) {
		font-size: 0.88rem;
		font-weight: 700;
		margin: 0;
		color: var(--ink, #111);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.panel-content {
		flex: 1;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		max-width: 640px;
		margin: 0 auto;
		width: 100%;
	}

	.question-title-heading {
		font-size: 1.25rem;
		font-weight: 800;
		color: var(--ink, #111);
		margin: 0;
		line-height: 1.3;
	}

	.constraints-intro {
		font-size: 0.78rem;
		color: var(--muted, #666);
		line-height: 1.4;
		margin: 0;
		font-style: italic;
	}

	.panel-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.section-title {
		font-size: 0.85rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted, #666);
		margin: 0;
		border-bottom: 1px solid var(--line, #ddd);
		padding-bottom: 0.25rem;
	}

	.empty-text {
		font-size: 0.82rem;
		color: var(--muted, #666);
		margin: 0;
	}

	/* ── Constraints Checklist ──────────────────────────────────────── */
	.constraints-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.constraint-item {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		padding: 0.6rem 0.75rem;
		background: color-mix(in srgb, var(--ink, #111) 2%, var(--paper, #fff));
		border: 1px solid var(--line, #ddd);
		border-radius: 8px;
	}

	.constraint-number {
		display: flex;
		align-items: flex-start;
		font-weight: 700;
		color: var(--primary, #4f7df9);
		font-size: 0.85rem;
		flex-shrink: 0;
	}

	.constraint-text {
		font-size: 0.82rem;
		line-height: 1.4;
		color: var(--ink, #111);
	}

	.description-wrap {
		font-size: 0.9rem;
		line-height: 1.5;
		color: var(--ink, #111);
	}

	.drawer-handle-container {
		display: flex;
		justify-content: center;
		padding: 1rem 0 0.5rem;
		margin-top: auto;
	}

	.drawer-handle {
		width: 40px;
		height: 5px;
		background: var(--line, #ddd);
		border-radius: 9999px;
	}
</style>
