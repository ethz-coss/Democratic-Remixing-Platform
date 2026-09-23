<script lang="ts">
	import { onMount } from 'svelte';
	import WysiwygMarkdownEditor from '$lib/components/WysiwygMarkdownEditor.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import FormField from '$lib/components/ui/FormField.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { page } from '$app/stores';

	let { form, data } = $props();

	const DRAFT_KEY = 'remix-question-draft';
	let constraints = $state<string[]>([]);
	let constraintInput = $state('');
	let constraintInputEl = $state<HTMLInputElement | null>(null);
	let title = $state('');
	let description = $state('');

	let initialGroup = $page.url.searchParams.get('group');
	let visibility = $state('Group');
	let groupId = $state(initialGroup || '');
	let currentPhaseName = $state('AnswerSearch');

	// Threshold
	let selectionTriggerThresholdPercent = $state(50);

	// Phase scheduling
	function todayStr() {
		const d = new Date();
		return d.toISOString().slice(0, 16); // yyyy-MM-ddTHH:mm
	}
	let startDate = $state(todayStr());
	let discussionDays = $state(14);
	let closingDays = $state(7);
	let voteDays = $state(7);

	// Computed deadlines
	let discussionDeadline = $derived.by(() => {
		const d = new Date(startDate);
		d.setDate(d.getDate() + discussionDays);
		return d;
	});
	let closingDeadline = $derived.by(() => {
		const d = new Date(discussionDeadline);
		d.setDate(d.getDate() + closingDays);
		return d;
	});
	let voteDeadline = $derived.by(() => {
		const d = new Date(closingDeadline);
		d.setDate(d.getDate() + voteDays);
		return d;
	});

	function formatDate(d: Date) {
		return d.toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function toISOString(d: Date) {
		return d.toISOString().replace('T', ' ').slice(0, 19);
	}

	function addConstraint() {
		const rawInput = constraintInputEl ? constraintInputEl.value : constraintInput;
		const nextConstraint = rawInput.trim();
		if (!nextConstraint) return;
		constraints = [...constraints, nextConstraint];
		constraintInput = '';
		if (constraintInputEl) {
			constraintInputEl.value = '';
			constraintInputEl.focus();
		}
	}

	function removeConstraint(index: number) {
		constraints = constraints.filter((_, i) => i !== index);
	}

	$effect(() => {
		if (!form) return;

		if (typeof form.title === 'string') {
			title = form.title;
		}

		if (typeof form.description === 'string') {
			description = form.description;
		}

		if (typeof form.currentPhaseName === 'string') {
			currentPhaseName = form.currentPhaseName;
		}

		if (Array.isArray(form.constraints)) {
			constraints = form.constraints
				.map((value: unknown) => String(value ?? '').trim())
				.filter(Boolean);
		}
	});

	onMount(() => {
		const raw = localStorage.getItem(DRAFT_KEY);
		if (!raw) return;

		try {
			const draft = JSON.parse(raw);
			title = String(draft.title ?? '');
			description = String(draft.description ?? '');
			constraints = Array.isArray(draft.constraints)
				? draft.constraints.map((item: unknown) => String(item ?? '')).filter(Boolean)
				: [];

			localStorage.removeItem(DRAFT_KEY);
		} catch {
			localStorage.removeItem(DRAFT_KEY);
		}
	});
</script>

<section class="stack" style="gap:1rem;">
	<header class="section-card stack" style="gap:0.45rem;">
		<p class="muted" style="margin:0;">{m.question_new_label()}</p>
		<h1 class="title">{m.question_new_title()}</h1>
	</header>

	<form method="POST" class="section-card stack">
		<FormField label={m.question_new_title_label()} required={true}>
			<input name="title" bind:value={title} minlength="5" maxlength="150" required />
		</FormField>

		<WysiwygMarkdownEditor
			name="description"
			label={m.question_new_description_label()}
			bind:html={description}
			placeholder={m.question_new_description_placeholder()}
			ariaLabel={m.question_new_description_aria()}
		/>

		<div class="stack" style="gap:0.45rem;">
			<FormField label={m.question_new_visibility_label()} style="max-width:22rem;">
				<select name="visibility" bind:value={visibility}>
					<option value="Public">{m.question_new_visibility_public()}</option>
					<option value="Group">{m.question_new_visibility_group()}</option>
					<option value="Private">{m.question_new_visibility_private()}</option>
				</select>
				<small class="muted">{m.question_new_visibility_help()}</small>
			</FormField>

			<FormField label={m.question_new_select_group()} style="max-width:22rem;" required={true}>
				<select name="group" bind:value={groupId} required>
					<option value="" disabled>{m.question_new_select_group_placeholder()}</option>
					{#each data.groups as g}
						<option value={g.id}>{g.name}</option>
					{/each}
				</select>
			</FormField>

			{#if data.user?.role === 'admin'}
				<FormField label={m.question_new_initial_phase_label()} style="max-width:22rem;">
					<select name="currentPhaseName" bind:value={currentPhaseName}>
						<option value="Proposed">Proposed</option>
						<option value="AnswerSearch">AnswerSearch</option>
						<option value="Closing">Closing</option>
						<option value="Voting">Voting</option>
					</select>
				</FormField>
			{/if}
		</div>

		<div class="stack" style="gap:0.45rem;">
			<div style="display:flex;justify-content:space-between;align-items:center;">
				<strong>{m.question_new_constraints_label()}</strong>
			</div>

			{#if constraints.length > 0}
				<ul style="margin:0;padding-left:1.2rem;display:grid;gap:0.35rem;">
					{#each constraints as constraint, i}
						<li style="display:flex;align-items:center;justify-content:space-between;gap:0.45rem;">
							<span>{constraint}</span>
							<Button
								variant="secondary"
								onclick={() => removeConstraint(i)}
								aria-label={m.question_new_constraint_remove_aria({ constraint })}
							>
								x
							</Button>
						</li>
					{/each}
				</ul>
			{/if}

			<div style="display:flex;gap:0.45rem;align-items:center;">
				<input
					bind:this={constraintInputEl}
					bind:value={constraintInput}
					type="text"
					autocomplete="off"
					placeholder={m.question_new_constraint_placeholder()}
					onkeydown={(event) => {
						if (event.key === 'Enter') {
							event.preventDefault();
							addConstraint();
						}
					}}
				/>
				<Button variant="secondary" onclick={addConstraint}>{m.question_new_add()}</Button>
			</div>

			{#each constraints as constraint}
				<input type="hidden" name="constraints" value={constraint} />
			{/each}
			<input type="hidden" name="constraintsJson" value={JSON.stringify(constraints)} />
		</div>

		<div class="stack" style="gap:0.45rem;">
			<FormField label={m.question_new_threshold_label()} style="max-width:22rem;" required={true}>
				<input
					name="selectionTriggerThresholdPercent"
					type="number"
					min="1"
					max="100"
					step="1"
					bind:value={selectionTriggerThresholdPercent}
					required
				/>
				<small class="muted">{m.question_new_threshold_help()}</small>
			</FormField>
		</div>

		<div class="stack" style="gap:0.75rem;">
			<strong>Phase Scheduling</strong>

			<FormField label="Start Date" style="max-width:22rem;" required={true}>
				<input type="datetime-local" bind:value={startDate} required />
			</FormField>

			<div class="phase-schedule-grid">
				<div class="phase-row">
					<FormField label="Discussion Duration (days)" style="flex:1;">
						<input type="number" min="1" max="365" bind:value={discussionDays} required />
					</FormField>
					<div class="phase-date-preview">
						<small class="muted">Ends</small>
						<span>{formatDate(discussionDeadline)}</span>
					</div>
				</div>

				<div class="phase-row">
					<FormField label="Closing Window (days)" style="flex:1;">
						<input type="number" min="1" max="365" bind:value={closingDays} required />
					</FormField>
					<div class="phase-date-preview">
						<small class="muted">Ends</small>
						<span>{formatDate(closingDeadline)}</span>
					</div>
				</div>

				<div class="phase-row">
					<FormField label="Voting Duration (days)" style="flex:1;">
						<input type="number" min="1" max="365" bind:value={voteDays} required />
					</FormField>
					<div class="phase-date-preview">
						<small class="muted">Ends</small>
						<span>{formatDate(voteDeadline)}</span>
					</div>
				</div>
			</div>

			<input type="hidden" name="discussion_deadline" value={toISOString(discussionDeadline)} />
			<input type="hidden" name="closing_window_deadline" value={toISOString(closingDeadline)} />
			<input type="hidden" name="vote_deadline" value={toISOString(voteDeadline)} />
		</div>

		<Button type="submit">{m.question_new_publish()}</Button>
		{#if form?.message}
			<p class="muted" style="color:#a03b2f;margin:0;">{form.message}</p>
		{/if}
	</form>
</section>

<style>
	.phase-schedule-grid {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.phase-row {
		display: flex;
		align-items: flex-end;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.phase-date-preview {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding-bottom: 0.3rem;
		min-width: 160px;
	}
	.phase-date-preview span {
		font-weight: 600;
		font-size: 0.9rem;
	}
</style>
