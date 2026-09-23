<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { feedViewState, getFilterState } from '$lib/feedView.svelte';
	import { editorState } from '$lib/editor.svelte';
	import * as T from '$lib/utils/terminology';
	import type { SortMode } from '$lib/services/feed-filter';
	import { logAction } from '$lib/services/telemetry';
	import {
		Pencil,
		ThumbsUp,
		Link,
		Wrench,
		Target,
		Puzzle,
		Scale,
		X,
		EyeOff,
		Sparkles,
		Globe,
		SlidersHorizontal
	} from '@lucide/svelte';

	import FilterBarShell from './ui/filter-bar/FilterBarShell.svelte';
	import FilterChip from './ui/filter-bar/FilterChip.svelte';
	import SearchBox from './ui/filter-bar/SearchBox.svelte';
	import SortControls from './ui/filter-bar/SortControls.svelte';

	interface Props {
		/** Bound two-way to parent's sort mode */
		sortMode?: SortMode;
		/** Bound two-way to parent's sort direction */
		sortDirection?: 'asc' | 'desc';
		/** Whether to show the sort controls */
		showSortControls?: boolean;
		/** Whether to show the Hidden filter */
		showHiddenFilter?: boolean;
		/** The current user's ID (for authored filter) */
		userId?: string | null;
		/** Display context to control chip visibility */
		context?: 'discover' | 'subscriptions' | 'related';
		/** Callback to change sort mode */
		onSortChange?: (mode: SortMode) => void;
		/** Available labels for filtering */
		labels?: App.LabelRecord[];
		/** Bound two-way to parent's filter states */
		onlySupported?: boolean;
		onlyAuthored?: boolean;
		onlyInFocus?: boolean;
		onlyChampions?: boolean;
		onlyCombinations?: boolean;
		onlyImprovements?: boolean;
		onlyUnseen?: boolean;
		searchQuery?: string;
		selectedLabelId?: string | null;
	}

	let {
		sortMode = $bindable('PersonalFocus'),
		sortDirection = $bindable('desc'),
		showSortControls = true,
		showHiddenFilter = false,
		userId = null,
		context,
		onSortChange,
		labels = [],
		onlySupported = $bindable(false),
		onlyAuthored = $bindable(false),
		onlyInFocus = $bindable(false),
		onlyChampions = $bindable(false),
		onlyCombinations = $bindable(false),
		onlyImprovements = $bindable(false),
		onlyUnseen = $bindable(false),
		searchQuery = $bindable(''),
		selectedLabelId = $bindable<string | null>(null)
	}: Props = $props();

	const hasActiveFilters = $derived(
		onlySupported ||
			onlyAuthored ||
			onlyInFocus ||
			onlyChampions ||
			onlyCombinations ||
			onlyImprovements ||
			onlyUnseen ||
			selectedLabelId !== null ||
			searchQuery.trim().length > 0
	);

	const SORT_OPTIONS = $derived.by(() => {
		const base: { value: SortMode; label: () => string }[] = [
			{ value: 'TopSupport', label: () => m.discovery_sort_top_support() },
			{ value: 'Newest', label: () => m.discovery_sort_newest() },
			{ value: 'RecentlyVisited', label: () => m.discovery_sort_recently_viewed() }
		];
		// In subscriptions/related contexts, keep PersonalFocus out since we don't have tabs there
		if (context !== 'discover' && context !== 'subscriptions' && context !== 'related') {
			base.unshift({ value: 'PersonalFocus', label: () => m.discovery_sort_foryou() });
		}
		return base;
	});

	let isSortRowExpanded = $state(false);

	const forceSearchExpanded = $derived(!showSortControls);

	function handleQueryChange(query: string) {
		searchQuery = query;
	}

	// Auto-select a valid sort mode if the current one is not allowed in this context
	$effect(() => {
		if (showSortControls) {
			const isValidOption = SORT_OPTIONS.some((opt) => opt.value === sortMode);
			if (!isValidOption) {
				sortMode = 'Newest';
				onSortChange?.('Newest');
			}
		}
	});

	let prevSort = $state(sortMode);
	let prevLabel = $state(selectedLabelId);

	$effect(() => {
		if (prevSort !== sortMode || prevLabel !== selectedLabelId) {
			logAction('feed_filter_change', {
				metadata: {
					sortMode,
					selectedLabelId
				}
			});
			prevSort = sortMode;
			prevLabel = selectedLabelId;
		}
	});

	function clearFilters() {
		onlySupported = false;
		onlyAuthored = false;
		onlyInFocus = false;
		onlyChampions = false;
		onlyCombinations = false;
		onlyImprovements = false;
		onlyUnseen = false;
		selectedLabelId = null;
		searchQuery = '';
		if (showSortControls) {
			sortMode = 'Newest';
			onSortChange?.('Newest');
		}
	}
</script>

<!-- Info Pill for Personal Focus is now outside the sticky shell -->
{#if sortMode === 'PersonalFocus'}
	<div class="foryou-info-pill-container">
		<div class="foryou-info-pill">
			<span class="info-icon">i</span>
			<span class="info-text"
				>Prioritizes ideas based on your Label support history, bridge-building potential, and
				unread status.</span
			>
		</div>
	</div>
{/if}

<FilterBarShell {hasActiveFilters}>
	{#snippet topRow()}
		<!-- Search -->
		<SearchBox
			{searchQuery}
			forceExpanded={forceSearchExpanded}
			onQueryChange={handleQueryChange}
		/>
	{/snippet}

	{#snippet sortRow()}
		{#if isSortRowExpanded && showSortControls && (context !== 'discover' || getFilterState(context).feedTab === 'all')}
			<div class="filter-row-sort">
				<SortControls
					{sortMode}
					{sortDirection}
					options={SORT_OPTIONS}
					showInfoTooltip={false}
					infoTooltipText=""
					onSortChange={(mode) => {
						sortMode = mode as SortMode;
						onSortChange?.(mode as SortMode);
					}}
					onDirectionToggle={() => (sortDirection = sortDirection === 'desc' ? 'asc' : 'desc')}
				/>
			</div>
		{/if}
	{/snippet}

	{#snippet chips()}
		<button
			type="button"
			class="row-label-btn"
			class:active={isSortRowExpanded}
			onclick={() => (isSortRowExpanded = !isSortRowExpanded)}
			title="Toggle sort options"
		>
			<SlidersHorizontal size={16} />
		</button>

		<!-- Supported -->
		{#if context !== 'discover' && context !== 'subscriptions' && sortMode !== 'PersonalFocus'}
			<FilterChip active={onlySupported} onclick={() => (onlySupported = !onlySupported)}>
				{#snippet icon()}
					<ThumbsUp size={14} class="inline-icon" />
				{/snippet}
				{m.discovery_filter_supported()}
			</FilterChip>
		{/if}

		<!-- Leading Ideas -->
		<FilterChip active={onlyChampions} onclick={() => (onlyChampions = !onlyChampions)}>
			{#snippet icon()}
				<T.ICON_CHAMPION size={13} class="inline-icon" fill="currentColor" />
			{/snippet}
			{T.TERM_LEADING_IDEA()}
		</FilterChip>

		<!-- Unseen -->
		<FilterChip active={onlyUnseen} onclick={() => (onlyUnseen = !onlyUnseen)}>
			{#snippet icon()}
				<span
					class="unseen-dot-list"
					style="width: 8px; height: 8px; border-radius: 50%; background-color: #3b82f6; display: inline-block; margin-right: 4px;"
				></span>
			{/snippet}
			{m.discovery_filter_unseen()}
		</FilterChip>

		<!-- Combinations -->
		<FilterChip active={onlyCombinations} onclick={() => (onlyCombinations = !onlyCombinations)}>
			{#snippet icon()}
				<Link size={14} class="inline-icon" />
			{/snippet}
			{m.discovery_filter_combinations()}
		</FilterChip>

		<!-- Improvements -->
		<FilterChip active={onlyImprovements} onclick={() => (onlyImprovements = !onlyImprovements)}>
			{#snippet icon()}
				<Wrench size={14} class="inline-icon" />
			{/snippet}
			{m.discovery_filter_improvements()}
		</FilterChip>

		<!-- On Ballot -->
		{#if sortMode !== 'PersonalFocus'}
			<FilterChip active={onlyInFocus} onclick={() => (onlyInFocus = !onlyInFocus)}>
				{#snippet icon()}
					<Target size={14} class="inline-icon" />
				{/snippet}
				{m.discovery_filter_in_focus()}
			</FilterChip>
		{/if}

		<!-- Available Labels -->
		{#each labels as label}
			<FilterChip
				active={selectedLabelId === label.id}
				variant="cluster"
				style="--chip-color: {label.color};"
				onclick={() => {
					if (selectedLabelId === label.id) {
						selectedLabelId = null;
					} else {
						selectedLabelId = label.id;
					}
				}}
			>
				{#snippet icon()}
					<Puzzle size={14} class="inline-icon" />
				{/snippet}
				{label.short_name}
			</FilterChip>
		{/each}
	{/snippet}
</FilterBarShell>

<style>
	.foryou-info-pill-container {
		padding: 0.5rem 0.75rem 0;
	}

	.filter-row-sort {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 30px;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.filter-row-sort::-webkit-scrollbar {
		display: none;
	}

	.row-label-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		border: none;
		background: transparent;
		color: var(--ink, #111);
		margin-right: 0.3rem;
		flex-shrink: 0;
		cursor: pointer;
		transition: background 0.2s;
	}
	.row-label-btn:hover {
		background: var(--bg-hover, #f3f4f6);
	}
	.row-label-btn.active {
		background: var(--color-primary-light, #e0e7ff);
		color: var(--color-primary, #4f46e5);
	}

	.foryou-info-pill {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		background: color-mix(in srgb, var(--info, #0284c7) 12%, transparent);
		border-radius: 8px;
		padding: 12px 14px;
		font-size: 0.85rem;
		line-height: 1.5;
		color: color-mix(in srgb, var(--info, #0284c7) 80%, var(--ink, #111));
		width: 100%;
		margin-bottom: 0.25rem;
	}

	.info-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		margin-top: 1px;
		border-radius: 50%;
		background: var(--info, #0284c7);
		color: white;
		font-weight: bold;
		font-size: 0.7rem;
		font-family: serif;
	}

	.info-text {
		line-height: 1.45;
	}
</style>
