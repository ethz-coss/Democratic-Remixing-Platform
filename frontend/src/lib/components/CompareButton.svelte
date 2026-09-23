<script lang="ts">
	import * as T from '$lib/utils/terminology';
	import { editorState } from '$lib/editor.svelte';
	import * as m from '$lib/paraglide/messages.js';

	let {
		proposal,
		addedText = m.compare_button_added(),
		compareText = m.compare_button(),
		buttonClass = '',
		style = '',
		size = 14
	} = $props<{
		proposal: App.ProposalRecord;
		addedText?: string;
		compareText?: string;
		buttonClass?: string;
		style?: string;
		size?: number;
	}>();

	let isInComparePool = $derived(editorState.comparePool.some((p) => p.id === proposal.id));
</script>

{#if isInComparePool}
	<button
		type="button"
		class="compare-btn active-pool {buttonClass}"
		{style}
		onclick={(e) => {
			e.stopPropagation();
			editorState.removeFromComparePool(proposal.id);
		}}
	>
		<T.ICON_MERGE {size} class="inline-icon" />
		{addedText}
	</button>
{:else}
	<button
		type="button"
		class="compare-btn {buttonClass}"
		{style}
		onclick={(e) => {
			e.stopPropagation();
			editorState.addToComparePool(proposal);
		}}
	>
		<T.ICON_MERGE {size} class="inline-icon" />
		{compareText}
	</button>
{/if}

<style>
	.compare-btn {
		border: 1px solid rgba(14, 165, 233, 0.3);
		background: rgba(14, 165, 233, 0.08);
		color: #0ea5e9;
		font-weight: 600;
		padding: 4px 10px;
		min-height: 28px;
		border-radius: 6px;
		cursor: pointer;
		line-height: 1.3;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		transition: all 0.15s ease;
		font-size: 0.75rem;
	}

	.compare-btn:hover {
		background: rgba(14, 165, 233, 0.15);
		border-color: rgba(14, 165, 233, 0.5);
	}

	.compare-btn.active-pool {
		background: var(--primary, #4f7df9);
		color: white;
		border-color: var(--primary, #4f7df9);
	}

	.compare-btn.active-pool:hover {
		background: color-mix(in srgb, var(--primary, #4f7df9) 80%, black);
	}
</style>
