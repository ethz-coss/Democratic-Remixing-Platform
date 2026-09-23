<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Visual style of the button */
		variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon';
		/** Size of the button */
		size?: 'sm' | 'md' | 'lg' | 'icon';
		/** HTML type attribute */
		type?: 'button' | 'submit' | 'reset';
		/** Whether the button is disabled */
		disabled?: boolean;
		/** Whether the button takes full width */
		block?: boolean;
		/** Additional CSS classes */
		class?: string;
		/** Click handler */
		onclick?: (event: MouseEvent) => void;
		/** Button content */
		children: Snippet;
		/** Any other attributes (aria-label, etc.) */
		[key: string]: any;
	}

	let {
		variant = 'primary',
		size = 'md',
		type = 'button',
		disabled = false,
		block = false,
		href = undefined,
		class: className = '',
		onclick,
		children,
		...rest
	}: Props & { href?: string } = $props();
</script>

{#if href}
	<a
		{href}
		class="btn variant-{variant} size-{size} {block ? 'block' : ''} {className}"
		class:disabled
		{...rest}
	>
		{@render children()}
	</a>
{:else}
	<button
		{type}
		{disabled}
		{onclick}
		class="btn variant-{variant} size-{size} {block ? 'block' : ''} {className}"
		{...rest}
	>
		{@render children()}
	</button>
{/if}

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-md, 6px);
		border: 1px solid transparent;
		font-weight: 700;
		cursor: pointer;
		text-decoration: none;
		transition:
			background-color 0.2s,
			border-color 0.2s,
			color 0.2s,
			opacity 0.2s;
	}

	.btn:disabled,
	.btn.disabled {
		opacity: 0.5;
		cursor: not-allowed;
		pointer-events: none;
	}

	.block {
		width: 100%;
	}

	/* Variants */
	.variant-primary {
		background: var(--ink);
		color: var(--paper);
		border-color: var(--ink);
	}

	.variant-primary:hover:not(:disabled) {
		background: color-mix(in srgb, var(--ink) 80%, transparent);
	}

	.variant-secondary {
		background: transparent;
		color: var(--ink);
		border-color: var(--ink);
	}

	.variant-secondary:hover:not(:disabled) {
		background: color-mix(in srgb, var(--ink) 5%, transparent);
	}

	.variant-ghost {
		background: transparent;
		color: var(--ink);
		border-color: transparent;
	}

	.variant-ghost:hover:not(:disabled) {
		background: color-mix(in srgb, var(--ink) 5%, transparent);
	}

	.variant-danger {
		background: var(--destructive, #dc2626);
		color: var(--paper);
		border-color: var(--destructive, #dc2626);
	}

	.variant-danger:hover:not(:disabled) {
		background: color-mix(in srgb, var(--destructive, #dc2626) 80%, transparent);
	}

	.variant-icon {
		background: transparent;
		color: var(--muted);
		border-color: transparent;
		border-radius: 50%;
	}

	.variant-icon:hover:not(:disabled) {
		background: color-mix(in srgb, var(--ink) 10%, transparent);
		color: var(--ink);
	}

	/* Sizes */
	.size-sm {
		padding: 0.4rem 0.75rem;
		font-size: 0.85rem;
	}

	.size-md {
		padding: 0.65rem 1rem;
		font-size: 1rem;
	}

	.size-lg {
		padding: 0.85rem 1.5rem;
		font-size: 1.1rem;
	}

	.size-icon {
		padding: 0;
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.1rem;
	}
</style>
