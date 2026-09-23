<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { localizePath } from '$lib/utils/i18n-path';
	import { Lightbulb, FileText, Users, Globe, Lock, Clock } from '@lucide/svelte';
	import PhaseOverview from '$lib/components/PhaseOverview.svelte';
	import { formatSwissDate } from '$lib/utils/time';

	let { data } = $props();

	const totalUsers = $derived(data.totalUsers ?? 0);
	const numLabels = $derived(data.labels?.length ?? 0);
	const numIdeas = $derived(data.proposals?.length ?? 0);

	let now = $state(Date.now());
	onMount(() => {
		if (!browser) return;
		const timer = setInterval(() => {
			now = Date.now();
		}, 1000);
		return () => clearInterval(timer);
	});
</script>

<div class="question-page">
	<header class="overview-header" style="margin-bottom: 2rem;">
		<!-- Title -->
		<h1 class="title" style="margin:0; font-size: 1.35rem; line-height: 1.25;">
			{data.question.title}
		</h1>
		<div
			style="font-size: 0.8rem; color: var(--muted); margin-top: 0.35rem; display: inline-flex; align-items: center; gap: 0.25rem;"
		>
			<Clock size={12} class="inline-icon" />
			{formatSwissDate(data.question.created)}
		</div>

		<!-- Activity Snapshot -->
		<div class="activity-snapshot mt-3">
			<div class="activity-chip">
				{#if data.question.visibility === 'Private'}
					<Lock size={14} style="color: var(--muted)" />
					<div class="activity-chip-text">
						<span class="stat-value">{totalUsers}</span>
						<span class="stat-label">{m.question_visibility_private_chip()}</span>
					</div>
				{:else if data.groupName}
					<Users size={14} style="color: var(--primary)" />
					<div class="activity-chip-text">
						<span class="stat-value">{totalUsers}</span>
						<span class="stat-label">
							<a href={localizePath(`/groups/${data.question.group}`)} class="group-link-inline">
								{data.groupName}
							</a>
						</span>
					</div>
				{:else}
					<Globe size={14} style="color: var(--muted)" />
					<div class="activity-chip-text">
						<span class="stat-value">{totalUsers}</span>
						<span class="stat-label">{m.question_visibility_public_chip()}</span>
					</div>
				{/if}
			</div>
			<div class="activity-chip">
				<FileText size={14} style="color: var(--muted)" />
				<div class="activity-chip-text">
					<span class="stat-value">{numIdeas}</span>
					<span class="stat-label">{m.question_stat_ideas_chip()}</span>
				</div>
			</div>
			<div class="activity-chip">
				<Lightbulb size={14} style="color: var(--muted)" />
				<div class="activity-chip-text">
					<span class="stat-value">{numLabels}</span>
					<span class="stat-label">{m.question_stat_labels_chip()}</span>
				</div>
			</div>
		</div>
	</header>

	<section class="phase-section">
		<PhaseOverview
			question={data.question}
			{now}
			hasVoted={data.hasVoted}
			championProposals={data.proposals.filter((p: { in_focus: boolean }) => p.in_focus)}
		/>
	</section>
</div>

<style>
	.question-page {
		padding: 1rem;
		max-width: 640px;
	}

	.title {
		font-size: 1.4rem;
		font-weight: 700;
		margin: 0 0 0.5rem;
		line-height: 1.3;
		color: var(--ink, #111);
	}

	.group-link-inline {
		color: var(--primary, #4f7df9);
		text-decoration: none;
		pointer-events: auto;
	}

	.group-link-inline:hover {
		text-decoration: underline;
	}

	.activity-snapshot {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
	}

	.activity-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.65rem;
		background: color-mix(in srgb, var(--ink, #111) 3%, var(--paper, #fff));
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--ink, #111) 6%, transparent);
	}

	.activity-chip-text {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		line-height: 1;
	}

	.activity-chip .stat-value {
		font-weight: 700;
		font-size: 0.85rem;
		color: var(--ink, #111);
	}

	.activity-chip .stat-label {
		color: var(--muted, #666);
		font-size: 0.75rem;
		letter-spacing: 0;
	}

	.phase-section {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		margin-bottom: 2rem;
	}

	@media (max-width: 640px) {
		.question-page {
			padding: 0.5rem;
		}

		.activity-snapshot {
			gap: 0.25rem 0.5rem;
		}

		.activity-chip {
			padding: 0.25rem 0.5rem;
		}
	}
</style>
