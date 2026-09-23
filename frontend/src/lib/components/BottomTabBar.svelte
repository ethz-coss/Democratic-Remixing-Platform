<script lang="ts">
	import { page } from '$app/state';
	import * as T from '$lib/utils/terminology';
	import { Plus } from '@lucide/svelte';
	import { localizePath } from '$lib/utils/i18n-path';
	import * as m from '$lib/paraglide/messages.js';
	import { editorState } from '$lib/editor.svelte';

	interface Props {
		questionId: string;
		/** Hide the tab bar (e.g. when editor modal is open) */
		hidden?: boolean;
		/** Display mode: 'bottom' (fixed bottom) or 'top' (legacy) */
		mode?: 'bottom' | 'top';
		/** The current phase of the question */
		currentPhase?: string;
		/** Whether the user can create a root proposal */
		canCreateRootProposal?: boolean;
		/** Whether the current user has already added at least one idea */
		userHasIdea?: boolean;
	}

	let {
		questionId,
		hidden = false,
		mode = 'bottom',
		currentPhase,
		canCreateRootProposal = false,
		userHasIdea = false
	}: Props = $props();

	const basePath = $derived(`/questions/${questionId}/proposals`);

	/* ── Active tab detection ────────────────────────────────────────── */
	type Tab = 'question' | 'discover' | 'subscriptions' | 'ballot' | 'new' | 'results';

	const activeTab = $derived.by((): Tab => {
		const path = page.url.pathname;
		if (path.endsWith('/ideas')) return 'discover';
		if (path.endsWith('/subscriptions')) return 'subscriptions';
		if (path.endsWith('/question')) return 'question';
		if (path.endsWith('/ballot')) return 'ballot';
		if (path.endsWith('/results')) return 'results';
		if (path.endsWith('/new')) return 'new';

		// If viewing a detail page, try to highlight the tab the user came from
		const fromTab = (page.state as any).fromTab;
		if (
			fromTab === 'ballot' ||
			fromTab === 'results' ||
			fromTab === 'subscriptions' ||
			fromTab === 'discover' ||
			fromTab === 'question'
		) {
			return fromTab;
		}

		// Fallback for direct detail page hits
		return 'discover';
	});

	const allTabs: {
		id: Tab;
		icon: any;
		labelKey: () => string;
		route: string;
		colorClass: string;
	}[] = [
		{
			id: 'question',
			icon: T.ICON_QUESTION,
			labelKey: () => m.tab_question(),
			route: 'question',
			colorClass: 'tab-question'
		},
		{
			id: 'discover',
			icon: T.ICON_DISCOVER,
			labelKey: () => m.tab_proposals(), // mapped to "Discover"
			route: 'ideas', // existing route reused
			colorClass: 'tab-discover'
		},
		{
			id: 'subscriptions',
			icon: T.ICON_SUBSCRIBE,
			labelKey: () => m.tab_subscriptions(),
			route: 'subscriptions',
			colorClass: 'tab-subscriptions'
		},
		{
			id: 'ballot',
			icon: T.ICON_BALLOT,
			labelKey: () => m.tab_focus(),
			route: 'ballot',
			colorClass: 'tab-ballot'
		},
		{
			id: 'results',
			icon: T.ICON_RESULTS,
			labelKey: () => m.tab_results(),
			route: 'results',
			colorClass: 'tab-results'
		}
	];

	// Phase gating logic
	const tabs = $derived.by(() => {
		let t = allTabs;
		if (currentPhase === 'Proposed') {
			t = t.filter((tab) => tab.id === 'question');
		} else if (currentPhase === 'Voting') {
			t = t.filter((tab) => tab.id === 'question' || tab.id === 'ballot');
		} else if (currentPhase === 'Closing') {
			// Closing = adjust subscriptions before vote — show discover, subscriptions, and ballot
			t = t.filter(
				(tab) =>
					tab.id === 'question' ||
					tab.id === 'discover' ||
					tab.id === 'subscriptions' ||
					tab.id === 'ballot'
			);
		} else if (currentPhase === 'Decided') {
			t = t.filter((tab) => tab.id === 'question' || tab.id === 'results');
		} else {
			// AnswerSearch phase
			t = t.filter((tab) => tab.id !== 'results');
		}
		return t;
	});

	const showPlusButton = $derived(canCreateRootProposal && currentPhase === 'AnswerSearch');
	const highlightPlus = $derived(showPlusButton && !userHasIdea);
</script>

{#if !hidden}
	<nav
		class="tab-bar {mode}"
		aria-label={m.nav_primary()}
		style="--columns: {tabs.length + (showPlusButton ? 1 : 0)}"
	>
		{#each tabs as tab, i (tab.id)}
			{#if i === 2 && showPlusButton}
				<a
					href={localizePath(`${basePath}/new`)}
					class="tab-item center-plus-btn {mode}"
					class:active={activeTab === 'new'}
					class:highlight={highlightPlus}
					aria-label="New proposal"
				>
					<span class="plus-circle">+</span>
				</a>
			{/if}
			{@const Icon = tab.icon}
			<a
				href={localizePath(`${basePath}/${tab.route}`)}
				class="tab-item {tab.colorClass}"
				class:active={activeTab === tab.id}
				aria-current={activeTab === tab.id ? 'page' : undefined}
			>
				<span class="tab-icon">
					<Icon size={20} />
				</span>
				<span class="tab-label">{tab.labelKey()}</span>
			</a>
		{/each}
	</nav>
{/if}

<style>
	/* ── Shared tab bar base ─────────────────────────────────────────── */
	.tab-bar {
		display: grid;
		background: var(--paper, #fff);
		border-top: 1px solid var(--line, #ddd);
		flex-shrink: 0;
		z-index: var(--z-tab-bar);
		grid-template-columns: repeat(var(--columns, 4), 1fr);
		height: calc(56px + var(--safe-b, 0px));
		padding-bottom: var(--safe-b, 0px);
	}

	/* ── Center Plus Button ──────────────────────────────────────────── */
	.center-plus-btn {
		background: transparent;
		border: none;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 0;
		color: var(--ink, #111);
	}

	.center-plus-btn .plus-circle {
		width: 60px;
		height: 60px;
		border-radius: 50%;
		background: var(--ink, #111);
		color: var(--paper, #fff);
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
		transition: transform 0.15s;
		transform: translateY(-16px);
		font-size: 1.75rem;
		font-weight: 700;
	}

	.center-plus-btn:active .plus-circle {
		transform: translateY(-16px) scale(0.95);
	}

	/* ── Highlight pulse when user hasn't added an idea yet ──────── */
	.center-plus-btn.highlight .plus-circle {
		background: var(--primary, #4f7df9);
		box-shadow:
			0 0 0 0 rgba(79, 125, 249, 0.5),
			0 2px 8px rgba(0, 0, 0, 0.2);
		animation: plus-pulse 2s ease-in-out infinite;
	}

	@keyframes plus-pulse {
		0%,
		100% {
			box-shadow:
				0 0 0 0 rgba(79, 125, 249, 0.5),
				0 2px 8px rgba(0, 0, 0, 0.2);
		}
		50% {
			box-shadow:
				0 0 0 10px rgba(79, 125, 249, 0),
				0 2px 12px rgba(79, 125, 249, 0.3);
		}
	}

	.center-plus-btn:hover .plus-circle {
		opacity: 0.85;
	}

	.tab-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.15rem;
		padding: 0.4rem 0.25rem;
		text-decoration: none;
		color: var(--muted, #5a5a5a);
		font-size: 0.72rem;
		font-weight: 600;
		transition:
			color 0.15s,
			background 0.15s;
		-webkit-tap-highlight-color: transparent;
		user-select: none;
	}

	.tab-item:hover {
		text-decoration: none;
		color: var(--ink, #111);
	}

	.tab-item.active {
		color: var(--ink, #111);
		background: color-mix(in srgb, var(--ink, #111) 6%, var(--paper, #fff));
	}

	.tab-item.active.tab-question {
		color: #0284c7;
		background: color-mix(in srgb, #0ea5e9 15%, transparent);
	}
	.tab-item.tab-question .tab-icon {
		color: #0284c7;
	}

	.tab-item.active.tab-ballot {
		color: #d97706;
		background: color-mix(in srgb, #f59e0b 15%, transparent);
	}
	.tab-item.tab-ballot .tab-icon {
		color: #d97706;
	}

	.tab-item.active.tab-discover {
		color: #10b981;
		background: color-mix(in srgb, #10b981 15%, transparent);
	}
	.tab-item.tab-discover .tab-icon {
		color: #10b981;
	}

	.tab-item.active.tab-results {
		color: #10b981;
		background: color-mix(in srgb, #10b981 15%, transparent);
	}
	.tab-item.tab-results .tab-icon {
		color: #10b981;
	}

	.tab-item.active.tab-subscriptions {
		color: var(--primary, #4f7df9);
		background: color-mix(in srgb, var(--primary, #4f7df9) 15%, transparent);
	}
	.tab-item.tab-subscriptions .tab-icon {
		color: var(--primary, #4f7df9);
	}

	.tab-icon {
		font-size: 1.25rem;
		line-height: 1;
	}

	.tab-label {
		line-height: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}
</style>
