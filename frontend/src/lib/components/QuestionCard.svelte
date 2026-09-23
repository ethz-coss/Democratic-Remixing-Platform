<script lang="ts">
	import { untrack } from 'svelte';
	import { localizePath } from '$lib/utils/i18n-path';
	import VoteControls from '$lib/components/VoteControls.svelte';
	import PhaseTimerProgress from '$lib/components/PhaseTimerProgress.svelte';
	import SupportTrack from '$lib/components/ui/SupportTrack.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { stripRichText } from '$lib/markdown';
	import * as m from '$lib/paraglide/messages.js';

	interface Props {
		question: App.QuestionRecord;
		userVote: number;
		canVote: boolean;
	}

	let { question, userVote, canVote }: Props = $props();
	const voteAction = $derived('?/vote');

	// `subscriptionCount` is kept as local state so the score label updates
	// immediately after a vote via the onVoteSuccess callback.
	// VoteControls manages its own UI state internally.
	let subscriptionCount = $state(untrack(() => Math.max(0, question.score)));

	const descriptionExcerpt = $derived(stripRichText(question.description));

	import { onMount } from 'svelte';
	import { browser } from '$app/environment';

	let now = $state(Date.now());
	onMount(() => {
		if (!browser) return;
		const timer = setInterval(() => {
			now = Date.now();
		}, 1000);
		return () => clearInterval(timer);
	});

	function phaseLabel(status: App.QuestionRecord['current_phase_name']) {
		switch (status) {
			case 'Proposed':
				return m.question_status_proposed();
			case 'AnswerSearch':
				return m.question_status_active_workspace();
			case 'Closing':
				return m.question_status_closing_window();
			case 'Voting':
				return m.question_status_final_vote();
			default:
				return status;
		}
	}
</script>

<article class="section-card stack">
	<header class="stack" style="gap:0.5rem;">
		<div style="display:flex; justify-content:space-between; align-items:flex-start;">
			<a class="title-link" href={localizePath(`/questions/${question.id}`)}
				><h2>{question.title}</h2></a
			>
			{#if question.visibility && question.visibility !== 'Public'}
				<Badge label={question.visibility} theme="muted" shape="pill" />
			{/if}
		</div>
		<div style="display:flex; justify-content:space-between; align-items:center;">
			<p class="muted" style="margin:0;">
				{m.question_phase_label({ phase: phaseLabel(question.current_phase_name) })}
			</p>
			{#if question.current_phase_name === 'Closing'}
				<PhaseTimerProgress
					phase="Closing"
					startsAt={question.updated}
					endsAt={question.closing_window_deadline}
					{now}
					variant="compact"
				/>
			{:else if question.current_phase_name === 'Voting'}
				<PhaseTimerProgress
					phase="Voting"
					startsAt={question.updated}
					endsAt={question.vote_deadline || question.discussion_deadline}
					{now}
					variant="compact"
				/>
			{:else if question.current_phase_name === 'AnswerSearch'}
				<PhaseTimerProgress
					phase="AnswerSearch"
					startsAt={question.updated}
					endsAt={question.discussion_deadline}
					{now}
					variant="compact"
				/>
			{/if}
		</div>
		<p class="muted" style="margin:0;">{m.question_score_label({ score: subscriptionCount })}</p>
	</header>

	<p class="excerpt">
		{descriptionExcerpt.slice(0, 220)}{descriptionExcerpt.length > 220 ? '…' : ''}
	</p>

	{#if question.constraints.length > 0}
		<div class="pill-list">
			{#each question.constraints as constraint (constraint)}
				<span class="pill">{constraint}</span>
			{/each}
		</div>
	{/if}

	<footer class="row">
		{#if question.current_phase_name === 'Proposed'}
			<VoteControls
				questionId={question.id}
				action={voteAction}
				subscriptionCount={Math.max(0, question.score)}
				{userVote}
				{canVote}
				onVoteSuccess={(sc) => (subscriptionCount = sc)}
			/>
		{:else}
			<span class="muted">{m.question_voting_closed()}</span>
		{/if}
		<a href={localizePath(`/questions/${question.id}`)}>{m.question_open()}</a>
	</footer>
</article>

<style>
	h2 {
		margin: 0;
		font-size: 1.1rem;
		line-height: 1.2;
	}

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.title-link {
		text-decoration: none;
		color: inherit;
	}

	.excerpt {
		margin: 0;
		line-height: 1.45;
	}
</style>
