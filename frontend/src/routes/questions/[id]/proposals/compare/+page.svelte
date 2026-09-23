<script lang="ts">
	import CompareSheet from '$lib/components/CompareSheet.svelte';
	import { isRemixingEnabled } from '$lib/utils/phase';
	let { data } = $props();
</script>

<CompareSheet
	allProposals={data.proposals}
	userVotes={data.userProposalVotes}
	canVote={!!data.user}
	creationDisabled={!isRemixingEnabled(data.question.current_phase_name)}
	labels={data.labels}
/>
