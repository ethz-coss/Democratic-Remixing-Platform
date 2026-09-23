<script lang="ts">
	import { goto } from '$app/navigation';
	import { localizePath } from '$lib/utils/i18n-path';
	import { onMount } from 'svelte';

	let { data } = $props();

	// This page exists only as the server action endpoint for the EditorSheet.
	// If a user navigates here directly, redirect them back to the arena.
	onMount(() => {
		goto(localizePath(`/questions/${data.question.id}/proposals/ballot`), { replaceState: true });
	});
</script>

<div
	style="display:flex;align-items:center;justify-content:center;height:50vh;color:var(--muted,#888);font-size:0.85rem;"
>
	Redirecting…
</div>
