<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import PhaseTimeline from '$lib/components/PhaseTimeline.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import {
		Lightbulb,
		Wrench,
		MessageSquare,
		ArrowRight,
		Merge,
		Star,
		BookOpen,
		Network,
		ChevronDown,
		Target
	} from '@lucide/svelte';

	const tabs = ['goal', 'process', 'concepts', 'tips'] as const;
	type Tab = (typeof tabs)[number];

	let activeTab = $state<Tab>('goal');
	const isOnboarding = $derived(page.url.searchParams.get('onboarding') === 'true');

	function nextTab() {
		const currentIndex = tabs.indexOf(activeTab);
		if (currentIndex < tabs.length - 1) {
			activeTab = tabs[currentIndex + 1];
			// Scroll to top
			if (typeof window !== 'undefined') {
				window.scrollTo({ top: 0, behavior: 'smooth' });
			}
		}
	}
</script>

<div class="how-it-works-page">
	<div class="header">
		<h1>{m.how_it_works_title()}</h1>
	</div>

	<div class="tabs">
		<button class="tab" class:active={activeTab === 'goal'} onclick={() => (activeTab = 'goal')}>
			{m.how_it_works_tab_goal?.() || 'Goal'}
		</button>
		<button
			class="tab"
			class:active={activeTab === 'process'}
			onclick={() => (activeTab = 'process')}
		>
			{m.how_it_works_tab_process()}
		</button>
		<button
			class="tab"
			class:active={activeTab === 'concepts'}
			onclick={() => (activeTab = 'concepts')}
		>
			{m.how_it_works_tab_concepts()}
		</button>
		<button class="tab" class:active={activeTab === 'tips'} onclick={() => (activeTab = 'tips')}>
			{m.how_it_works_tab_tips()}
		</button>
	</div>

	<div class="tab-content">
		{#if activeTab === 'goal'}
			<div class="goal-tab">
				<div class="card bg-base-100/50 border-base-200 border p-6">
					<div class="mb-4 flex items-center gap-3">
						<Target class="text-primary" size={24} />
						<h3 class="text-lg font-bold">{m.how_it_works_tab_goal?.() || 'Goal'}</h3>
					</div>
					<p class="text-base-content/90 leading-relaxed">
						{m.how_it_works_goal_text()}
					</p>
				</div>
				{#if isOnboarding}
					<div class="onboarding-actions">
						<Button variant="primary" onclick={nextTab} class="w-full sm:w-auto">
							{m.common_next()}: {m.how_it_works_tab_process()}
							<ArrowRight size={16} />
						</Button>
					</div>
				{/if}
			</div>
		{:else if activeTab === 'process'}
			<div class="process-tab">
				<PhaseTimeline currentPhase="AnswerSearch" interactive={true} detailed={true} />
			</div>
			{#if isOnboarding}
				<div class="onboarding-actions">
					<Button variant="primary" onclick={nextTab} class="w-full sm:w-auto">
						{m.common_next()}: {m.how_it_works_tab_concepts()}
						<ArrowRight size={16} />
					</Button>
				</div>
			{/if}
		{:else if activeTab === 'concepts'}
			<div class="concepts-grid">
				<!-- 1. Ideas -->
				<details class="concept-card">
					<summary class="concept-header">
						<div class="concept-header-top">
							<span class="icon-title">
								<Lightbulb size={18} class="text-primary" />
								<h3>{m.how_it_works_concept_remix_title()}</h3>
							</span>
							<ChevronDown size={16} class="chevron" />
						</div>
						<p class="concept-short">{m.how_it_works_concept_remix_desc()}</p>
					</summary>
					<div class="concept-content">
						<p>
							{m.how_it_works_concept_remix_extended()}
						</p>
					</div>
				</details>

				<!-- 2. Labels -->
				<details class="concept-card">
					<summary class="concept-header">
						<div class="concept-header-top">
							<span class="icon-title">
								<Network size={18} class="text-primary" />
								<h3>{m.how_it_works_concept_theme_title()}</h3>
							</span>
							<ChevronDown size={16} class="chevron" />
						</div>
						<p class="concept-short">{m.how_it_works_concept_theme_desc()}</p>
					</summary>
					<div class="concept-content">
						<p>
							{m.how_it_works_concept_theme_extended()}
						</p>
					</div>
				</details>

				<!-- 3. Subscriptions -->
				<details class="concept-card">
					<summary class="concept-header">
						<div class="concept-header-top">
							<span class="icon-title">
								<Star size={18} class="text-primary" />
								<h3>{m.how_it_works_concept_support_title()}</h3>
							</span>
							<ChevronDown size={16} class="chevron" />
						</div>
						<p class="concept-short">{m.how_it_works_concept_support_desc()}</p>
					</summary>
					<div class="concept-content">
						<p>
							{m.how_it_works_concept_support_extended()}
						</p>
					</div>
				</details>

				<!-- 4. Discover Feed -->
				<details class="concept-card">
					<summary class="concept-header">
						<div class="concept-header-top">
							<span class="icon-title">
								<MessageSquare size={18} class="text-primary" />
								<h3>{m.how_it_works_concept_feed_title()}</h3>
							</span>
							<ChevronDown size={16} class="chevron" />
						</div>
						<p class="concept-short">{m.how_it_works_concept_feed_desc()}</p>
					</summary>
					<div class="concept-content">
						<p>
							{m.how_it_works_concept_feed_extended()}
						</p>
					</div>
				</details>

				<!-- 5. Ballot -->
				<details class="concept-card">
					<summary class="concept-header">
						<div class="concept-header-top">
							<span class="icon-title">
								<BookOpen size={18} class="text-primary" />
								<h3>{m.how_it_works_concept_ballot_title()}</h3>
							</span>
							<ChevronDown size={16} class="chevron" />
						</div>
						<p class="concept-short">{m.how_it_works_concept_ballot_desc()}</p>
					</summary>
					<div class="concept-content">
						<p>
							{m.how_it_works_concept_ballot_extended()}
						</p>
					</div>
				</details>
			</div>
			{#if isOnboarding}
				<div class="onboarding-actions">
					<Button variant="primary" onclick={nextTab} class="w-full sm:w-auto">
						{m.common_next()}: {m.how_it_works_tab_tips()}
						<ArrowRight size={16} />
					</Button>
				</div>
			{/if}
		{:else if activeTab === 'tips'}
			<ul class="tips-list">
				<li>
					<div class="tip-content">
						<span class="tip-icon"><Lightbulb size={16} /></span>
						<span class="tip-text">{m.how_it_works_tip_1()}</span>
					</div>
				</li>
				<li>
					<div class="tip-content">
						<span class="tip-icon"><Wrench size={16} /></span>
						<span class="tip-text">{m.how_it_works_tip_2()}</span>
					</div>
				</li>
				<li>
					<div class="tip-content">
						<span class="tip-icon"><ArrowRight size={16} /></span>
						<span class="tip-text">{m.how_it_works_tip_3()}</span>
					</div>
				</li>
				<li>
					<div class="tip-content">
						<span class="tip-icon"><Merge size={16} /></span>
						<span class="tip-text">{m.how_it_works_tip_4()}</span>
					</div>
				</li>
				<li>
					<div class="tip-content">
						<span class="tip-icon"><Star size={16} /></span>
						<span class="tip-text">{m.how_it_works_tip_5()}</span>
					</div>
				</li>
			</ul>
			{#if isOnboarding}
				<div class="onboarding-actions final">
					<form method="POST" action="?/completeOnboarding" use:enhance>
						<Button variant="primary" type="submit" class="pulse-btn w-full sm:w-auto">
							{m.common_start()}
							<ArrowRight size={16} />
						</Button>
					</form>
				</div>
			{/if}
		{/if}
	</div>
</div>

<style>
	.onboarding-actions {
		margin-top: 2rem;
		display: flex;
		justify-content: flex-end;
		animation: fade-in 0.3s ease-out;
	}

	.onboarding-actions.final {
		justify-content: center;
		margin-top: 3rem;
	}

	:global(.pulse-btn) {
		box-shadow: 0 0 0 0 rgba(79, 125, 249, 0.4);
		animation: pulse-ring 2s infinite cubic-bezier(0.66, 0, 0, 1);
	}

	@keyframes pulse-ring {
		to {
			box-shadow: 0 0 0 15px rgba(79, 125, 249, 0);
		}
	}

	.how-it-works-page {
		padding: 1rem;
		max-width: 640px;
		margin: 0 auto;
	}

	.header {
		margin-bottom: 1.5rem;
	}

	.header h1 {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--ink, #111);
	}

	.tabs {
		display: flex;
		gap: 0.5rem;
		background: color-mix(in srgb, var(--ink, #111) 4%, var(--paper, #fff));
		padding: 0.25rem;
		border-radius: 8px;
		margin-bottom: 1.5rem;
	}

	.tab {
		flex: 1;
		padding: 0.5rem;
		border-radius: 6px;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--muted, #666);
		background: transparent;
		border: none;
		cursor: pointer;
		transition: all 0.2s;
	}

	.tab:hover {
		color: var(--ink, #111);
	}

	.tab.active {
		background: var(--paper, #fff);
		color: var(--ink, #111);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
	}

	.tab-content {
		min-height: 60vh;
	}

	.process-tab {
		padding: 2rem 0;
	}

	.concepts-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1rem;
	}

	@media (min-width: 600px) {
		.concepts-grid {
			grid-template-columns: 1fr 1fr;
		}
	}

	.concept-card {
		background: var(--paper, #fff);
		border: 1px solid var(--line, #ddd);
		border-radius: 8px;
		overflow: hidden;
	}

	.concept-header {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 1rem;
		cursor: pointer;
		list-style: none; /* Hide default triangle in some browsers */
	}

	.concept-header-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
	}

	.concept-header::-webkit-details-marker {
		display: none; /* Hide default triangle in WebKit */
	}

	.icon-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.concept-header h3 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 700;
	}

	.concept-content {
		padding: 0 1rem 1rem 1rem;
	}

	.concept-card p {
		margin: 0;
		font-size: 0.85rem;
		color: var(--muted, #666);
		line-height: 1.4;
	}

	.concept-short {
		margin: 0;
		font-size: 0.85rem;
		color: var(--ink, #111);
		line-height: 1.4;
	}

	.tips-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.tips-list li {
		background: var(--paper, #fff);
		border-radius: 8px;
		border: 1px solid var(--line, #ddd);
		overflow: hidden;
	}

	.tip-content {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		padding: 1rem;
		text-decoration: none;
		color: inherit;
		transition: background 0.15s;
	}

	.tip-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 8px;
		background: color-mix(in srgb, var(--primary, #4f7df9) 15%, var(--paper, #fff));
		color: var(--primary, #4f7df9);
		flex-shrink: 0;
	}

	.tip-text {
		flex: 1;
		font-size: 0.9rem;
		color: var(--ink, #111);
		line-height: 1.4;
		margin-top: 0.3rem;
	}
</style>
