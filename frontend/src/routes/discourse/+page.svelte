<script lang="ts">
	import { browser } from '$app/environment';
	import * as m from '$lib/paraglide/messages.js';
	import { getRemainingPercentage, formatTimeRemaining } from '$lib/utils/time';
	import { invalidateAll } from '$app/navigation';
	import { localizePath } from '$lib/utils/i18n-path';
	import { onMount } from 'svelte';
	import { startQuestionRealtimeSync } from '$lib/realtime/question-phase';
	import PhaseTimerProgress from '$lib/components/PhaseTimerProgress.svelte';
	import SupportTrack from '$lib/components/ui/SupportTrack.svelte';
	import { stripRichText } from '$lib/markdown';
	import { fade } from 'svelte/transition';
	import type { PageData } from './$types';
	import Button from '$lib/components/ui/Button.svelte';
	import { Users, Globe, ChevronRight } from '@lucide/svelte';
	import * as T from '$lib/utils/terminology';

	let { data }: { data: PageData } = $props();

	let activeTab = $state<'all' | 'decided'>('all');
	let now = $state(Date.now());

	const visibleQuestions = $derived(
		activeTab === 'all' ? data.allQuestions : data.decidedQuestions
	);

	onMount(() => {
		if (!browser) {
			return;
		}

		const timer = setInterval(() => {
			now = Date.now();
		}, 1000);

		let dispose = () => {};
		let cancelled = false;

		void startQuestionRealtimeSync({
			collections: ['questions'],
			onRefresh: () => {
				void invalidateAll();
			}
		}).then((nextDispose) => {
			if (cancelled) {
				nextDispose();
				return;
			}
			dispose = nextDispose;
		});

		return () => {
			clearInterval(timer);
			cancelled = true;
			dispose();
		};
	});

	function relativeTime(iso: string): string {
		const date = new Date(iso.replace(' ', 'T'));
		if (isNaN(date.getTime())) return '';
		const diff = Date.now() - date.getTime();
		const minutes = Math.floor(diff / 60_000);
		if (minutes < 1) return m.discourse_time_just_now();
		if (minutes < 60) return m.discourse_time_minutes({ n: minutes });
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return m.discourse_time_hours({ n: hours });
		const days = Math.floor(hours / 24);
		if (days < 30) return m.discourse_time_days({ n: days });
		const months = Math.floor(days / 30);
		return m.discourse_time_months({ n: months });
	}

	function ideaSummary(ideaCount: number, clusterCount: number): string {
		if (ideaCount === 0) return m.discourse_no_ideas_yet();
		if (clusterCount <= 1) return m.discourse_ideas_no_variants({ ideas: ideaCount });
		const variants = ideaCount - clusterCount;
		if (variants <= 0) return m.discourse_ideas_no_variants({ ideas: ideaCount });
		return m.discourse_ideas_summary({ labels: clusterCount, variants });
	}
</script>

<section class="stack" style="gap:1.25rem;">
	<header class="section-card stack" style="gap:0.4rem;">
		<h1 class="title">{m.discourse_title()}</h1>
		<p class="muted description-text" style="margin:0;">
			{m.discourse_list_description()}
		</p>
	</header>

	<!-- Tab bar -->
	<nav class="tab-bar" aria-label={m.discourse_tabs_aria()}>
		<button
			id="tab-all"
			type="button"
			class="tab-btn"
			class:active={activeTab === 'all'}
			aria-selected={activeTab === 'all'}
			role="tab"
			onclick={() => {
				activeTab = 'all';
			}}
		>
			{m.discourse_tab_all()}
			{#if data.allQuestions.length > 0}
				<span class="tab-count">{data.allQuestions.length}</span>
			{/if}
		</button>

		<button
			id="tab-decided"
			type="button"
			class="tab-btn"
			class:active={activeTab === 'decided'}
			aria-selected={activeTab === 'decided'}
			role="tab"
			onclick={() => {
				activeTab = 'decided';
			}}
		>
			{m.discourse_tab_decided()}
			{#if data.decidedQuestions.length > 0}
				<span class="tab-count">{data.decidedQuestions.length}</span>
			{/if}
		</button>
	</nav>

	{#if visibleQuestions.length === 0}
		<article class="section-card stack">
			<h2 style="margin:0;">
				{activeTab === 'all' ? m.discourse_no_question_title() : m.discourse_no_decided_title()}
			</h2>
			<p class="muted" style="margin:0;">
				{activeTab === 'all'
					? m.discourse_no_question_subtitle()
					: m.discourse_no_decided_subtitle()}
			</p>
		</article>
	{:else}
		<div class="stack" style="gap:1.25rem;">
			{#each visibleQuestions as question (question.id)}
				{@const descriptionPreview = stripRichText(question.description)}
				{@const stats = data.proposalStatsByQuestion[question.id] ?? {
					ideaCount: 0,
					clusterCount: 0
				}}
				{@const activeUsersCount = data.activeUsersByQuestion[question.id] ?? 0}
				{@const timeAgo = relativeTime(question.updated)}
				{@const groupName = question.group ? data.groupNamesById[question.group] : null}
				{@const PhaseIcon = T.PHASE_ICON[question.current_phase_name] || T.PHASE_ICON['Proposed']}
				{@const phaseClass =
					question.current_phase_name === 'AnswerSearch'
						? 'answer-search'
						: question.current_phase_name.toLowerCase()}

				<div class="question-card card stack">
					<h2 class="question-title">
						<a
							href={localizePath(`/questions/${question.id}/proposals`)}
							class="stealth-link stretched-link">{question.title}</a
						>
					</h2>
					<div style="display: flex; gap: 0.5rem; align-items: center; margin-top: -0.25rem;">
						<span class="phase-badge {phaseClass}">
							<PhaseIcon size={14} class="inline-icon" style="margin-right:4px;" />
							{T.PHASE_LABEL(question.current_phase_name)}
						</span>
					</div>

					{#if descriptionPreview.length > 0}
						<p class="excerpt line-clamp-2">
							{descriptionPreview}
						</p>
					{/if}

					<div class="meta-row">
						{#if groupName}
							<a
								href={localizePath(`/groups/${question.group}`)}
								class="group-badge"
								onclick={(e) => e.stopPropagation()}
							>
								<Users size={14} class="inline-icon" style="margin-right:4px;" />
								{groupName}
							</a>
						{:else}
							<span class="group-badge public"
								><Globe size={14} class="inline-icon" style="margin-right:4px;" />
								{m.discourse_public()}</span
							>
						{/if}
						<span class="meta-sep" aria-hidden="true">·</span>
						<span class="idea-stat">{ideaSummary(stats.ideaCount, stats.clusterCount)}</span>
						{#if timeAgo}
							<span class="meta-sep" aria-hidden="true">·</span>
							<span>{m.discourse_updated_label({ time: timeAgo })}</span>
						{/if}
					</div>

					{#if question.current_phase_name === 'AnswerSearch'}
						{@const remainingPct = getRemainingPercentage(
							question.updated,
							question.discussion_deadline,
							now
						)}
						<div class="quorum-bar-wrap">
							<div style="display: flex; justify-content: space-between;">
								<span
									class="quorum-bar-label"
									style="color: var(--primary, #4f7df9); font-weight: 600;"
								>
									Time remaining in discussion
								</span>
								<span
									class="quorum-bar-label"
									style="color: var(--primary, #4f7df9); font-weight: 700;"
								>
									{formatTimeRemaining(question.discussion_deadline, now)}
								</span>
							</div>
							<SupportTrack value={remainingPct} theme="brand" size="md" />
						</div>
					{/if}

					{#if question.current_phase_name === 'Closing'}
						{@const remainingPct = getRemainingPercentage(
							question.updated,
							question.closing_window_deadline,
							now
						)}
						<div class="quorum-bar-wrap">
							<div style="display: flex; justify-content: space-between;">
								<span class="quorum-bar-label" style="color: var(--warning); font-weight: 600;">
									Time until voting starts
								</span>
								<span class="quorum-bar-label" style="color: var(--warning); font-weight: 700;">
									{#if question.closing_window_deadline}
										{formatTimeRemaining(question.closing_window_deadline, now)}
									{:else}
										--:--:--
									{/if}
								</span>
							</div>
							<SupportTrack value={remainingPct} theme="warning" size="md" />
						</div>
					{/if}

					{#if question.current_phase_name === 'Voting'}
						{@const remainingPct = getRemainingPercentage(
							question.updated,
							question.vote_deadline,
							now
						)}
						<div class="quorum-bar-wrap">
							<div style="display: flex; justify-content: space-between;">
								<span class="quorum-bar-label" style="color: var(--success); font-weight: 600;">
									Time remaining to cast ballot
								</span>
								<span class="quorum-bar-label" style="color: var(--success); font-weight: 700;">
									{formatTimeRemaining(question.vote_deadline || question.discussion_deadline, now)}
								</span>
							</div>
							<SupportTrack value={remainingPct} theme="success" size="md" />
						</div>
					{/if}

					{#if question.current_phase_name === 'Decided'}
						<div class="quorum-bar-wrap">
							<span class="quorum-bar-label" style="color: var(--ink); font-weight: 600;">
								Answer Set: {stats.ideaCount} proposals ranked
							</span>
						</div>
					{/if}

					<div class="card-footer-chevron">
						<span class="chevron-text">
							{question.current_phase_name === 'Decided'
								? m.discourse_view_results()
								: m.discourse_enter_space()}
						</span>
						<ChevronRight size={18} />
					</div>
				</div>
			{/each}
		</div>
	{/if}
</section>

<style>
	.description-text {
		line-height: 1.55;
	}

	/* Tab bar */
	.tab-bar {
		display: flex;
		border-bottom: 1px solid var(--line);
		gap: 0;
	}

	.tab-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.6rem 0.9rem;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--muted);
		cursor: pointer;
		margin-bottom: -1px;
		transition:
			color 120ms ease,
			border-color 120ms ease;
	}

	.tab-btn:hover {
		color: var(--ink);
	}

	.tab-btn.active {
		color: var(--ink);
		border-bottom-color: var(--ink);
	}

	.tab-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--line);
		color: var(--muted);
		font-size: 0.72rem;
		font-weight: 700;
		min-width: 1.2rem;
		height: 1.2rem;
		padding: 0 0.3rem;
		border-radius: 0;
	}

	.tab-btn.active .tab-count {
		background: var(--ink);
		color: var(--paper);
	}

	/* Cards */
	.question-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
		border-radius: 12px;
		border: 1px solid var(--line, #ddd);
		position: relative;
		overflow: hidden;
		background: var(--paper, #fff);
		text-decoration: none;
		color: inherit;
		transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
	}

	@media (min-width: 640px) {
		.question-card {
			padding: 1.5rem;
			gap: 1rem;
		}
	}

	.question-card:hover {
		border-color: color-mix(in srgb, var(--primary, #4f7df9) 40%, transparent);
		box-shadow:
			0 4px 20px rgba(0, 0, 0, 0.04),
			0 2px 8px rgba(0, 0, 0, 0.02);
		transform: translateY(-2px);
	}

	.question-title {
		font-size: 1.25rem;
		font-weight: 700;
		line-height: 1.25;
		margin: 0;
		color: var(--ink, #111);
	}

	@media (min-width: 640px) {
		.question-title {
			font-size: 1.35rem;
		}
	}

	.excerpt {
		margin: 0;
		line-height: 1.6;
		color: color-mix(in srgb, var(--ink) 80%, transparent);
		font-size: 0.95rem;
	}

	.line-clamp-2 {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.meta-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 0.5rem;
		align-items: center;
		font-size: 0.82rem;
		color: var(--muted);
	}

	.idea-stat {
		font-weight: 500;
	}

	.meta-sep {
		color: var(--line);
	}

	/* Quorum bar */
	.quorum-bar-wrap {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.quorum-bar-label {
		font-size: 0.78rem;
		color: var(--muted);
	}

	.card-footer-chevron {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.25rem;
		margin-top: 0.5rem;
		color: var(--primary, #4f7df9);
		font-weight: 600;
		font-size: 0.85rem;
		transition: transform 0.2s ease;
	}

	.question-card:hover .card-footer-chevron {
		transform: translateX(4px);
	}

	.chevron-text {
		opacity: 0.9;
	}

	/* Group Badge */
	.group-badge {
		display: inline-flex;
		align-items: center;
		font-weight: 500;
		color: var(--ink);
		text-decoration: none;
		transition: color 0.15s ease;
		position: relative;
		z-index: 2;
	}

	a.group-badge:hover {
		color: var(--primary, #4f7df9);
		text-decoration: underline;
	}

	.group-badge.public {
		color: var(--muted);
	}

	.stealth-link.stretched-link::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 1;
	}
</style>
