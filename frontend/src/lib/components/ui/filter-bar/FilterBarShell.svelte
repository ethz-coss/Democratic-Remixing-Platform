<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		hasActiveFilters?: boolean;
		infoRow?: Snippet;
		topRow: Snippet;
		sortRow?: Snippet;
		chips?: Snippet;
	}

	let { hasActiveFilters = false, infoRow, topRow, sortRow, chips }: Props = $props();
</script>

<div class="filter-bar" class:has-active={hasActiveFilters}>
	<!-- ── Row 0: Info text (optional) ─────────────────────────────────────── -->
	{#if infoRow}
		<div class="filter-info-row">
			{@render infoRow()}
		</div>
	{/if}

	<!-- ── Row 1: Display toggle tabs + Search + Sort ──────────────────────── -->
	<div class="filter-row-top">
		{@render topRow()}
	</div>

	<!-- ── Row 2: Filter Chips ─────────────────────────────────────────────── -->
	{#if chips}
		<div class="filter-chips" role="group" aria-label="Active filters">
			{@render chips()}
		</div>
	{/if}

	<!-- ── Row 3: Sort Options ───────────────────────────────────────────── -->
	{#if sortRow}
		{@render sortRow()}
	{/if}
</div>

<style>
	/* ── Filter bar shell ──────────────────────────────────────────────── */
	.filter-bar {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding: 0.5rem 0.75rem 0.45rem;
		background: var(--color-bg-secondary, #fff);
		border-bottom: 1px solid var(--line, #e5e7eb);
		position: sticky;
		top: 0;
		z-index: var(--z-sticky);
	}

	/* ── Row 0: Info text ──────────────────────────────────────────────── */
	.filter-info-row {
		display: flex;
		width: 100%;
		margin-bottom: -0.25rem; /* pull up slightly because gap handles spacing */
	}

	/* ── Row 1: search + sort + display toggle ─────────────────────────── */
	.filter-row-top {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 36px;
	}

	/* ── Row 2: filter chips ────────────────────────────────────────────── */
	.filter-chips {
		display: flex;
		gap: 0.35rem;
		overflow-x: auto;
		scrollbar-width: none;
		padding-bottom: 1px; /* prevent clipping */
	}

	.filter-chips::-webkit-scrollbar {
		display: none;
	}

	/* ── Mobile: tighten the top row a bit ─────────────────────────────── */
	@media (max-width: 480px) {
		.filter-bar {
			padding: 0.4rem 0.5rem 0.35rem;
		}
	}
</style>
