<script lang="ts">
	import { ArrowDownWideNarrow, ArrowUpNarrowWide, Info } from '@lucide/svelte';

	interface Props {
		sortMode: string;
		sortDirection: 'asc' | 'desc';
		options: { value: string; label: string | (() => string) }[];
		showInfoTooltip?: boolean;
		infoTooltipText?: string;
		onSortChange: (mode: string) => void;
		onDirectionToggle: () => void;
	}

	let {
		sortMode,
		sortDirection,
		options,
		showInfoTooltip = false,
		infoTooltipText = '',
		onSortChange,
		onDirectionToggle
	}: Props = $props();
</script>

<div class="sort-controls-chips">
	{#each options as opt (opt.value)}
		<button
			type="button"
			class="sort-chip"
			class:active={sortMode === opt.value}
			onclick={() => onSortChange(opt.value)}
		>
			{typeof opt.label === 'function' ? opt.label() : opt.label}
		</button>
	{/each}

	{#if showInfoTooltip}
		<div class="sort-info-tooltip" title={infoTooltipText}>
			<Info size={14} />
		</div>
	{/if}

	<div class="sort-divider-end"></div>

	<button
		type="button"
		class="direction-btn"
		aria-label={sortDirection === 'desc' ? 'Sort descending' : 'Sort ascending'}
		onclick={onDirectionToggle}
	>
		<span class="sort-icon-wrapper">
			{#if sortDirection === 'desc'}
				<ArrowDownWideNarrow size={14} />
			{:else}
				<ArrowUpNarrowWide size={14} />
			{/if}
		</span>
	</button>
</div>

<style>
	.sort-controls-chips {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
	}

	.sort-divider-end {
		width: 1px;
		height: 18px;
		background: var(--line, #e5e7eb);
		flex-shrink: 0;
		margin-left: 0.25rem;
	}

	.sort-chip {
		flex-shrink: 0;
		height: 30px;
		padding: 0 0.65rem;
		border: 1px solid transparent;
		border-radius: 16px;
		font-size: 0.73rem;
		font-weight: 500;
		background: var(--color-bg-tertiary, #f0f0f0);
		color: var(--muted, #555);
		cursor: pointer;
		white-space: nowrap;
		display: flex;
		align-items: center;
		transition: all 0.15s;
	}

	.sort-chip:hover {
		background: var(--color-bg-hover, #e5e7eb);
		color: var(--ink, #111);
	}

	.sort-chip.active {
		background: var(--ink, #111);
		color: var(--paper, #fff);
	}

	.sort-info-tooltip {
		display: flex;
		align-items: center;
		color: var(--muted, #5a5a5a);
		cursor: help;
	}

	.direction-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 30px;
		width: 30px;
		border-radius: 50%;
		border: none;
		background: transparent;
		color: var(--muted, #555);
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
		flex-shrink: 0;
	}

	.direction-btn:hover {
		background: var(--color-bg-tertiary, #f3f4f6);
		color: var(--color-primary, #4f7df9);
	}

	.sort-icon-wrapper {
		display: flex;
		align-items: center;
		justify-content: center;
	}
</style>
