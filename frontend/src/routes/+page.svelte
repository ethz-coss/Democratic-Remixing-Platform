<script lang="ts">
	import QuestionCard from '$lib/components/QuestionCard.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { localizePath } from '$lib/utils/i18n-path';

	let { data } = $props();
</script>

<section class="stack" style="gap:1rem;">
	<header class="section-card stack" style="gap:0.5rem;">
		<p class="muted" style="margin:0;">{m.home_phase_label()}</p>
		<h1 class="title">{m.home_title()}</h1>
		<p class="muted" style="margin:0;">
			{m.home_subtitle()}
		</p>
		<div>
			<Button variant="primary" href={localizePath('/questions/new')}
				>{m.home_propose_button()}</Button
			>
		</div>
	</header>

	{#if data.questions.length === 0}
		<article class="section-card stack">
			<h2 style="margin:0;">{m.home_no_proposals_title()}</h2>
			<p class="muted" style="margin:0;">
				{m.home_no_proposals_subtitle()}
			</p>
			<Button variant="primary" href={localizePath('/questions/new')}
				>{m.home_propose_button()}</Button
			>
		</article>
	{:else}
		<div class="stack" style="gap:0.9rem;">
			{#each data.questions as question (question.id)}
				<QuestionCard
					{question}
					userVote={data.userVotes[question.id] ?? 0}
					canVote={Boolean(data.user)}
				/>
			{/each}
		</div>
	{/if}
</section>
