<script lang="ts">
	import { editorState } from '$lib/editor.svelte';
	import CompareSheet from './CompareSheet.svelte';
	import EditorSheet from './EditorSheet.svelte';

	let {
		questionId,
		user,
		allProposals,
		userVotes,
		creationDisabled = false,
		labels = []
	} = $props<{
		questionId: string;
		user: any;
		allProposals: App.ProposalRecord[];
		userVotes?: Record<string, number>;
		creationDisabled?: boolean;
		labels?: App.LabelRecord[];
	}>();
</script>

<div class="compare-combi-sheet-overlay">
	{#if editorState.phase === 'combine' || editorState.phase === 'improve'}
		<EditorSheet {questionId} {user} {labels} />
	{/if}
</div>

<style>
	.compare-combi-sheet-overlay {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: var(--paper, #fff);
		z-index: var(--z-overlay);
		display: flex;
		flex-direction: column;
	}
</style>
