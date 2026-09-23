<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { enhance } from '$app/forms';
	import { localizePath } from '$lib/utils/i18n-path';
	import { goBackWithFallback } from '$lib/utils/nav';
	import { untrack } from 'svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import FormField from '$lib/components/ui/FormField.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let currentStatus = $state(untrack(() => data.question.current_phase_name));
	let isSubmitting = $state(false);

	$effect(() => {
		// Sync the local state with the server data when it updates after a successful action
		currentStatus = data.question.current_phase_name;
	});
</script>

<div class="container mx-auto max-w-3xl p-4">
	<div class="mb-4">
		<button onclick={() => goBackWithFallback('/discourse')} class="btn btn-ghost btn-sm pl-0">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="mr-1 h-4 w-4"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M10 19l-7-7m0 0l7-7m-7 7h18"
				/>
			</svg>
			Back
		</button>
	</div>

	<div class="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
		<h1 class="text-2xl font-bold">Manage Question</h1>
		<a
			href={localizePath(`/questions/${data.question.id}`)}
			class="btn btn-sm btn-outline w-full sm:w-auto"
		>
			View Public Question Page
		</a>
	</div>

	{#if form?.message}
		<div class="alert alert-error mb-4 shadow-sm">
			<span>{form.message}</span>
		</div>
	{/if}

	{#if form?.ok}
		<div class="alert alert-success mb-4 shadow-sm">
			<span>Phase transitioned successfully.</span>
		</div>
	{/if}

	<div class="card bg-base-100 border-base-200 border shadow-md">
		<div class="card-body p-4 sm:p-8">
			<h2 class="card-title mb-2 text-xl leading-tight break-words">{data.question.title}</h2>
			<div class="mb-6 flex flex-wrap items-center gap-2">
				<div class="badge badge-primary">{data.question.current_phase_name}</div>
				{#if data.question.visibility && data.question.visibility !== 'Public'}
					<span class="badge badge-outline">{data.question.visibility}</span>
				{/if}
			</div>

			<div class="divider">Phase Transition</div>

			<FormField
				label="Force Phase Transition"
				required={false}
				helpText="This directly overrides the current phase logic and manually updates the database. Use with caution."
			>
				<form
					method="POST"
					action="?/forcePhaseTransition"
					style="display:flex; gap:0.75rem;"
					use:enhance={() => {
						isSubmitting = true;
						return async ({ update }) => {
							await update({ reset: false });
							isSubmitting = false;
						};
					}}
				>
					<input type="hidden" name="questionId" value={data.question.id} />
					<select
						name="nextPhase"
						id="nextPhase"
						style="flex:1;"
						class="select select-bordered"
						bind:value={currentStatus}
						disabled={isSubmitting}
					>
						<option value="Proposed">Proposed</option>
						<option value="AnswerSearch">AnswerSearch</option>
						<option value="Closing">Closing</option>
						<option value="Voting">Voting</option>
					</select>
					<Button
						type="submit"
						variant="danger"
						disabled={isSubmitting || currentStatus === data.question.current_phase_name}
					>
						{isSubmitting ? 'Updating...' : 'Force Update'}
					</Button>
				</form>
			</FormField>
		</div>
	</div>
</div>
