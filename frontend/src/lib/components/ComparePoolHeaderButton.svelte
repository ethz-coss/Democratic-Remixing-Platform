<script lang="ts">
	import { editorState } from '$lib/editor.svelte';
	import * as T from '$lib/utils/terminology';
	import { schemeCategory10 } from 'd3';
	import { page } from '$app/stores';
	import { localizePath } from '$lib/utils/i18n-path';
	import { openProposalModal } from '$lib/utils/nav';
	import * as m from '$lib/paraglide/messages.js';

	interface Props {
		labels?: App.LabelRecord[];
	}

	let { labels = [] }: Props = $props();

	function timeAgo(dateStr: string) {
		const created = Date.parse(dateStr);
		if (!Number.isFinite(created)) return '';
		const diff = Date.now() - created;
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'now';
		if (mins < 60) return `${mins}m`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h`;
		const days = Math.floor(hrs / 24);
		return `${days}d`;
	}

	function moveUp(index: number) {
		if (index > 0) {
			const pool = [...editorState.comparePool];
			[pool[index - 1], pool[index]] = [pool[index], pool[index - 1]];
			editorState.comparePool = pool;
		}
	}

	function moveDown(index: number) {
		if (index < editorState.comparePool.length - 1) {
			const pool = [...editorState.comparePool];
			[pool[index + 1], pool[index]] = [pool[index], pool[index + 1]];
			editorState.comparePool = pool;
		}
	}

	let isOpen = $state(false);

	function toggle() {
		isOpen = !isOpen;
	}

	function close() {
		isOpen = false;
	}

	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';

	function handleStart() {
		editorState.openCompareFromPool();
		close();
		goto(localizePath(`/questions/${$page.params.id}/proposals/compare`));
	}

	let dropdownRef: HTMLDivElement | null = null;

	onMount(() => {
		if (!browser) return;
		const handleClickOutside = (event: MouseEvent) => {
			if (isOpen && dropdownRef && !dropdownRef.contains(event.target as Node)) {
				close();
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
		};
	});
</script>

<div class="compare-pool-container" bind:this={dropdownRef}>
	<button
		class="compare-pool-btn"
		class:has-items={editorState.comparePool.length > 0}
		onclick={toggle}
		aria-label={m.aria_compare_pool()}
	>
		<T.ICON_COMPARE size={16} />
		{#if editorState.comparePool.length > 0}
			<span class="count-badge">{editorState.comparePool.length}</span>
		{/if}
	</button>

	{#if isOpen}
		<div class="compare-pool-dropdown">
			<div class="dropdown-header">
				<h3>Compare {T.TERM_PROPOSALS()}</h3>
				<button class="clear-btn" onclick={() => editorState.clearComparePool()}
					>{m.action_clear_all()}</button
				>
			</div>

			<div class="pool-items">
				{#each editorState.comparePool as item, index (item.id)}
					{@const actualItem =
						($page.data.proposals || []).find((p: any) => p.id === item.id) || item}
					<div class="pool-item">
						<a
							class="item-info"
							href={localizePath(`/questions/${$page.params.id}/proposals/${actualItem.id}`)}
							onclick={(e) => {
								isOpen = false;
								openProposalModal(
									e,
									localizePath(`/questions/${$page.params.id}/proposals/${actualItem.id}`)
								);
							}}
						>
							<div class="item-meta">
								<span
									class="cluster-dot"
									style="background-color: {actualItem.color ||
										(labels.find((l) => l.id === (actualItem.primary_label || actualItem.id))
											?.color ??
											'#a9a9a9')}"
								></span>
								<span class="item-author">{actualItem.author_name || m.author_anonymous()}</span>
								<span class="item-time">· {timeAgo(actualItem.created)}</span>
							</div>
							<span class="item-title" title={actualItem.title}
								>Idea {index + 1}: {actualItem.title}</span
							>
						</a>

						<div class="item-actions">
							<div class="order-controls">
								<button class="order-btn" onclick={() => moveUp(index)} disabled={index === 0}
									>▲</button
								>
								<button
									class="order-btn"
									onclick={() => moveDown(index)}
									disabled={index === editorState.comparePool.length - 1}>▼</button
								>
							</div>
							<button
								class="remove-btn"
								onclick={() => editorState.removeFromComparePool(item.id)}
								aria-label={m.aria_remove_item({ title: item.title ?? 'item' })}
							>
								<svg
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<line x1="18" y1="6" x2="6" y2="18"></line>
									<line x1="6" y1="6" x2="18" y2="18"></line>
								</svg>
							</button>
						</div>
					</div>
				{:else}
					<div class="empty-state">{m.compare_pool_empty()}</div>
				{/each}
			</div>

			<div class="dropdown-footer">
				<button
					class="start-btn"
					disabled={editorState.comparePool.length < 2}
					onclick={handleStart}
				>
					{m.action_start_comparison()}
				</button>
				{#if editorState.comparePool.length < 2}
					<p class="hint">{m.compare_select_minimum()}</p>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.compare-pool-container {
		position: relative;
		display: inline-block;
	}

	.compare-pool-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		border: 1px solid var(--line, #ddd);
		background: transparent;
		color: var(--text-secondary, #666);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.compare-pool-btn:hover {
		background: var(--bg-hover, #f5f5f5);
		color: var(--text-primary, #111);
	}

	.compare-pool-btn.has-items {
		border-color: var(--primary, #4f7df9);
		color: var(--primary, #4f7df9);
	}

	.count-badge {
		position: absolute;
		top: -4px;
		right: -4px;
		background: var(--primary, #4f7df9);
		color: white;
		font-size: 0.65rem;
		font-weight: 600;
		width: 16px;
		height: 16px;
		border-radius: 8px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.compare-pool-dropdown {
		position: absolute;
		top: 100%;
		right: 0;
		margin-top: 8px;
		width: 280px;
		background: var(--paper, #fff);
		border: 1px solid var(--line, #ddd);
		border-radius: var(--radius-md, 8px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
		z-index: var(--z-dropdown);
		display: flex;
		flex-direction: column;
	}

	.dropdown-header {
		padding: 12px;
		border-bottom: 1px solid var(--line, #ddd);
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.dropdown-header h3 {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
	}

	.clear-btn {
		background: none;
		border: none;
		color: var(--text-secondary, #666);
		font-size: 0.8rem;
		cursor: pointer;
	}
	.clear-btn:hover {
		color: var(--danger, #e74c3c);
	}

	.pool-items {
		max-height: 200px;
		overflow-y: auto;
		padding: 8px 0;
	}

	.pool-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 12px;
	}

	.pool-item:hover {
		background: var(--bg-hover, #f5f5f5);
	}

	.item-info {
		display: flex;
		flex-direction: column;
		flex-grow: 1;
		margin: 0 8px 0 0;
		min-width: 0;
		text-decoration: none;
		color: inherit;
		cursor: pointer;
	}
	.item-info:hover .item-title {
		color: var(--primary, #4f7df9);
	}

	.item-meta {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 0.65rem;
		color: var(--text-tertiary, #999);
		margin-bottom: 2px;
	}

	.cluster-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		display: inline-block;
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.1);
	}

	.item-author {
		font-weight: 500;
	}

	.item-title {
		font-size: 0.85rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.item-actions {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.order-controls {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.order-btn {
		background: none;
		border: none;
		padding: 4px 6px;
		font-size: 0.75rem;
		line-height: 1;
		color: var(--text-tertiary, #999);
		cursor: pointer;
		border-radius: 4px;
	}
	.order-btn:hover:not(:disabled) {
		background: var(--bg-hover, #eee);
		color: var(--text-primary, #111);
	}
	.order-btn:disabled {
		opacity: 0.3;
		cursor: default;
	}

	.remove-btn {
		background: none;
		border: none;
		color: var(--text-tertiary, #999);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 6px;
		border-radius: 4px;
	}
	.remove-btn:hover {
		background: rgba(0, 0, 0, 0.05);
		color: var(--text-primary, #111);
	}

	.empty-state {
		padding: 16px;
		text-align: center;
		color: var(--text-tertiary, #999);
		font-size: 0.85rem;
	}

	.dropdown-footer {
		padding: 12px;
		border-top: 1px solid var(--line, #ddd);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.start-btn {
		width: 100%;
		padding: 8px;
		background: var(--primary, #4f7df9);
		color: white;
		border: none;
		border-radius: var(--radius-sm, 6px);
		font-weight: 600;
		cursor: pointer;
	}
	.start-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.hint {
		margin: 0;
		font-size: 0.75rem;
		text-align: center;
		color: var(--text-tertiary, #999);
	}

	/* ── No Drag & Drop CSS ── */
</style>
