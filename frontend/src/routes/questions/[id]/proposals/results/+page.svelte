<script lang="ts">
	import VotingResults from '$lib/components/VotingResults.svelte';
	import { feedViewState } from '$lib/feedView.svelte';

	let { data } = $props();

	// Explicitly declare this page as a results tab
	feedViewState.subView = 'focus';

	let championProposals = $derived(data.proposals.filter((p) => p.in_focus));
</script>

<div class="results-page" style="padding: 1rem; padding-bottom: 2rem;">
	<VotingResults
		proposals={championProposals}
		votingSummary={data.votingSummary}
		questionId={data.question.id}
	/>
</div>
