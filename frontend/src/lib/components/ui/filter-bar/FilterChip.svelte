<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		active?: boolean;
		variant?: 'default' | 'cluster';
		onclick?: () => void;
		icon?: Snippet;
		children: Snippet;
		title?: string;
		style?: string;
	}

	let {
		active = false,
		variant = 'default',
		onclick,
		icon,
		children,
		title,
		style
	}: Props = $props();
</script>

<button
	type="button"
	class="chip"
	class:active
	class:chip-cluster={variant === 'cluster'}
	{onclick}
	aria-pressed={active}
	{title}
	{style}
>
	{#if icon}
		{@render icon()}
	{/if}
	{@render children()}
</button>

<style>
	.chip {
		flex-shrink: 0;
		height: 32px;
		padding: 0 0.65rem;
		border: 1px solid var(--line, #e5e7eb);
		border-radius: 20px;
		font-size: 0.73rem;
		font-weight: 500;
		background: transparent;
		color: var(--muted, #555);
		cursor: pointer;
		white-space: nowrap;
		display: flex;
		align-items: center;
		gap: 3px;
		transition:
			background 0.15s,
			color 0.15s,
			border-color 0.15s;
	}

	.chip:hover {
		border-color: var(--color-primary, #4f7df9);
		color: var(--color-primary, #4f7df9);
	}

	.chip.active {
		background: color-mix(in srgb, var(--color-primary, #4f7df9) 15%, transparent);
		border-color: var(--color-primary, #4f7df9);
		color: var(--color-primary, #4f7df9);
		font-weight: 700;
	}

	.chip-cluster {
		border-color: color-mix(in srgb, var(--chip-color, var(--line, #e5e7eb)) 40%, transparent);
		color: var(--chip-color, var(--muted, #555));
	}

	.chip-cluster:hover {
		border-color: var(--chip-color, var(--color-accent, #7c3aed));
		color: var(--chip-color, var(--color-accent, #7c3aed));
	}

	.chip-cluster.active {
		background: color-mix(
			in srgb,
			var(--chip-color, var(--color-accent, #7c3aed)) 15%,
			transparent
		);
		border-color: var(--chip-color, var(--color-accent, #7c3aed));
		color: var(--chip-color, var(--color-accent, #7c3aed));
	}

	:global(.chip .inline-icon) {
		vertical-align: -2px;
	}
</style>
