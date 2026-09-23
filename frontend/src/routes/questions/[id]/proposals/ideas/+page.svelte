<script lang="ts">
	import DiscoveryFeed from '$lib/components/DiscoveryFeed.svelte';
	import { feedViewState, getFilterState } from '$lib/feedView.svelte';
	import { isRemixingEnabled } from '$lib/utils/phase';

	let { data } = $props();

	// Force this page to show the 'all' sub-view immediately
	$effect(() => {
		feedViewState.subView = 'all';
		getFilterState('discover').onlySupported = false;
	});
</script>

<div class="ideas-page-wrapper">
	<div class="view-container">
		<DiscoveryFeed
			filterContext="discover"
			proposals={data.proposals}
			userVotes={data.userProposalVotes}
			focusQuorum={data.question.focus_quorum ?? 0}
			disabled={!data.user}
			creationDisabled={!isRemixingEnabled(data.question.current_phase_name)}
			focusReasons={data.focusReasons ?? {}}
			userVoteTimestamps={data.userVoteTimestamps ?? {}}
			labels={data.labels ?? []}
			unseenImprovements={data.unseenImprovements ?? {}}
			seenProposalIds={data.seenProposalIds ?? []}
			user={data.user}
			questionId={data.question.id}
			currentPhase={data.question.current_phase_name}
			totalUsers={data.totalUsers ?? 0}
			closingWindowDeadline={data.question.closing_window_deadline}
			userHiddenProposalIds={data.userHiddenProposalIds ?? []}
		/>
	</div>
</div>

<style>
	.ideas-page-wrapper {
		width: 100%;
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.view-container {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		position: relative;
	}
</style>
