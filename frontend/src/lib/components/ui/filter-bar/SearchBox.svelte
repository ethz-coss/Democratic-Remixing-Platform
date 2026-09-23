<script lang="ts">
	import { Search } from '@lucide/svelte';
	import * as m from '$lib/paraglide/messages.js';

	interface Props {
		searchQuery: string;
		forceExpanded?: boolean;
		onQueryChange: (query: string) => void;
		onToggleExpand?: (expanded: boolean) => void;
	}

	let { searchQuery, forceExpanded = false, onQueryChange, onToggleExpand }: Props = $props();

	let searchExpanded = $state(false);
	let searchInputEl = $state<HTMLInputElement | null>(null);

	// Sync from prop
	$effect(() => {
		if (forceExpanded || searchQuery.trim().length > 0) {
			if (!searchExpanded) {
				searchExpanded = true;
				onToggleExpand?.(true);
			}
		}
	});

	function toggleSearch() {
		if (forceExpanded) return;
		searchExpanded = !searchExpanded;
		onToggleExpand?.(searchExpanded);

		if (!searchExpanded) {
			onQueryChange('');
		} else {
			setTimeout(() => searchInputEl?.focus(), 50);
		}
	}
</script>

<div class="search-wrapper" class:expanded={searchExpanded || forceExpanded}>
	<!-- Always render input so it's visible, but control width via CSS -->
	<div class="search-inner">
		<Search size={16} class="search-icon-inline" />
		<input
			bind:this={searchInputEl}
			type="search"
			class="search-input"
			placeholder={m.search_placeholder()}
			value={searchQuery}
			oninput={(e) => onQueryChange((e.currentTarget as HTMLInputElement).value)}
			aria-label="Search"
		/>
	</div>
</div>

<style>
	.search-wrapper {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		transition: flex 0.2s ease;
		flex: 1; /* Always take up some space */
		min-width: 140px;
	}

	.search-inner {
		position: relative;
		display: flex;
		align-items: center;
		width: 100%;
		height: 36px;
		border: 1px solid var(--line, #e5e7eb);
		border-radius: 20px;
		background: var(--color-surface-50, #f8fafc);
		padding: 0 0.5rem 0 0.75rem;
		transition: all 0.2s;
	}

	.search-inner:focus-within {
		background: var(--color-bg-secondary, #fff);
		border-color: var(--color-primary, #4f7df9);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary, #4f7df9) 25%, transparent);
	}

	.search-input {
		width: 100%;
		height: 100%;
		border: none;
		background: transparent;
		color: var(--ink, #111);
		outline: none;
		font-size: 14px;
	}
</style>
