<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { Sparkles, Globe, EyeOff, Pencil } from '@lucide/svelte';

	let { feedTab = $bindable<'foryou' | 'all' | 'mine' | 'hidden'>(), authoredCount = 0 } = $props<{
		feedTab: 'foryou' | 'all' | 'mine' | 'hidden';
		authoredCount?: number;
	}>();

	function setTab(tab: 'foryou' | 'all' | 'mine' | 'hidden') {
		feedTab = tab;
	}
</script>

<div class="feed-tab-bar-container">
	<div class="feed-tab-bar">
		<button class="feed-tab-btn" class:active={feedTab === 'all'} onclick={() => setTab('all')}>
			<Globe size={16} />
			<span>{m.feed_tab_all()}</span>
		</button>
		<button
			class="feed-tab-btn"
			class:active={feedTab === 'foryou'}
			onclick={() => setTab('foryou')}
		>
			<Sparkles size={16} />
			<span>{m.feed_tab_foryou()}</span>
		</button>
		{#if authoredCount > 0}
			<button class="feed-tab-btn" class:active={feedTab === 'mine'} onclick={() => setTab('mine')}>
				<Pencil size={16} />
				<span>{m.feed_tab_mine()}</span>
			</button>
		{/if}
		<button
			class="feed-tab-btn"
			class:active={feedTab === 'hidden'}
			onclick={() => setTab('hidden')}
		>
			<EyeOff size={16} />
			<span>{m.feed_tab_hidden()}</span>
		</button>
	</div>
</div>

<style>
	.feed-tab-bar-container {
		position: sticky;
		top: 0;
		z-index: 5;
		background-color: var(--surface);
		width: 100%;
		border-bottom: 1px solid var(--line);
		margin-bottom: 0.5rem;
	}

	.feed-tab-bar {
		display: flex;
		max-width: 100%;
		overflow-x: auto;
		/* Show a thin scrollbar to indicate it's scrollable */
		scrollbar-width: thin;
		scrollbar-color: var(--line) transparent;
	}
	.feed-tab-bar::-webkit-scrollbar {
		height: 4px;
	}
	.feed-tab-bar::-webkit-scrollbar-track {
		background: transparent;
	}
	.feed-tab-bar::-webkit-scrollbar-thumb {
		background-color: var(--line);
		border-radius: 4px;
	}

	.feed-tab-btn {
		flex: 1 0 auto;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		padding: 0.65rem 0.35rem;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--muted);
		cursor: pointer;
		margin-bottom: -1px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition:
			color 120ms ease,
			border-color 120ms ease,
			background-color 120ms ease;
	}

	.feed-tab-btn span {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.feed-tab-btn:hover {
		color: var(--ink);
		background-color: var(--surface-hover);
	}

	.feed-tab-btn.active {
		color: var(--primary);
		border-bottom-color: var(--primary);
		background-color: color-mix(in srgb, var(--primary) 8%, transparent);
	}

	@media (min-width: 480px) {
		.feed-tab-btn {
			gap: 0.4rem;
			padding: 0.75rem 0.5rem;
			font-size: 0.9rem;
		}
	}
</style>
