<script lang="ts">
	import VotingBallot from '$lib/components/VotingBallot.svelte';
	import ProposalCard from '$lib/components/ProposalCard.svelte';
	import { feedViewState } from '$lib/feedView.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { Info, ChevronDown } from '@lucide/svelte';
	import * as T from '$lib/utils/terminology';

	import { invalidate } from '$app/navigation';

	let { data, form } = $props();

	// Explicitly declare this page as a ballot tab
	feedViewState.subView = 'focus';

	// ── FINAL VOTING LOGIC ──
	let championProposals = $derived(data.proposals.filter((p) => p.in_focus));

	let now = $state(Date.now());
	onMount(() => {
		if (!browser) return;
		void invalidate('app:proposals');
		const timer = setInterval(() => {
			now = Date.now();
		}, 1000);
		return () => clearInterval(timer);
	});

	// ── ANSWER SEARCH LOGIC ──
	let showFocusExplainer = $state(false);

	const isClosing = $derived(data.question.current_phase_name === 'Closing');
	const isVoting = $derived(data.question.current_phase_name === 'Voting');

	const focusProposals = $derived.by(() => {
		const active = data.proposals.filter((s) => s.in_focus);
		return [...active].sort((a, b) => {
			const diff = (b.subscription_count ?? 0) - (a.subscription_count ?? 0);
			if (diff !== 0) return diff;
			return new Date(b.created).getTime() - new Date(a.created).getTime();
		});
	});

	const totalUsers = $derived(data.totalUsers ?? 0);
	const activeLabelCount = $derived(data.labels?.length ?? 0);
</script>

{#if isVoting}
	<div class="mb-8" style="padding: 0 1rem;">
		<VotingBallot
			proposals={championProposals}
			action="?/submitBallot"
			questionId={data.question.id}
			labels={data.labels ?? []}
			previousRanks={data.previousRanks}
			previousAbstention={data.previousAbstention}
			{form}
		/>
	</div>
{:else}
	<!-- Answer Search ballot view -->
	<div
		class="focus-view-container stack"
		style="gap:1.5rem; padding-bottom: 2rem; padding-top: 1rem; padding-left: 1rem; padding-right: 1rem; box-sizing: border-box; max-width: 100%;"
	>
		<h2 class="title" style="font-size: 1.75rem; margin-bottom: 0.25rem;">{m.ballot_title()}</h2>
		<!-- ── Ballot intro banner ── -->
		<p class="focus-ballot-intro">{m.ballot_closing_intro()}</p>

		<!-- ── Ballot explainer + readiness section ── -->
		<div
			class="focus-readiness-section"
			class:phase-closing={isClosing}
			class:phase-final={isVoting}
		>
			<!-- Collapsible explainer -->
			<button
				type="button"
				class="focus-explainer-toggle"
				onclick={() => (showFocusExplainer = !showFocusExplainer)}
			>
				<span class="focus-explainer-icon"><Info size={16} /></span>
				<span class="focus-explainer-title">{m.ballot_how_formed()}</span>
				<span class="focus-explainer-chevron" class:open={showFocusExplainer}
					><ChevronDown size={14} /></span
				>
			</button>

			{#if showFocusExplainer}
				<div class="focus-explainer-body">
					{#if isClosing}
						<p>
							{@html m.discovery_focus_explanation_closing({
								time: m.discovery_24_hours(),
								proposals: T.TERM_PROPOSALS().toLowerCase()
							})}
						</p>
					{:else}
						<p>
							{m.discovery_focus_explanation_p1()}
						</p>
						<div style="margin-bottom: 1rem;">
							{@html m.discovery_focus_explanation_p2()}
						</div>
						<p>
							{@html m.discovery_focus_explanation_p3({
								url: `/questions/${data.question.id}/proposals/question`
							})}
						</p>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Proposal cards: ranked focus/ballot list -->
		<div class="feed-list ballot-list">
			{#if focusProposals.length === 0}
				<div class="empty-state">
					<p>{m.feed_empty_ballot()}</p>
				</div>
			{/if}
			{#each focusProposals as proposal, idx (proposal.id)}
				{@const label = data.labels.find((l: App.LabelRecord) => l.id === proposal.primary_label)}
				{@const clusterColor = label?.color ?? undefined}
				{@const barPct =
					Math.min(100, ((proposal.subscription_count ?? 0) / Math.max(1, totalUsers)) * 100) || 0}
				<div class="ballot-rank-row">
					<span class="ballot-rank-num" aria-label={m.ballot_rank_aria({ rank: String(idx + 1) })}
						>{idx + 1}</span
					>
					<ProposalCard
						variant="standard"
						{proposal}
						isSeen={data.seenProposalIds?.includes(proposal.id)}
						userVote={data.userProposalVotes?.[proposal.id] ?? 0}
						canVote={!!data.user}
						hideCompare={false}
						{barPct}
						{clusterColor}
						activeLabels={(proposal.labels || [])
							.map((id) => data.labels.find((l) => l.id === id))
							.filter((l): l is App.LabelRecord => Boolean(l))
							.map((l) => ({ id: l.id, short_name: l.short_name, color: l.color }))}
						isChampion={true}
						isAuthored={!!(data.user && proposal.author === data.user.id)}
						subscriptionCount={proposal.subscription_count ?? 0}
					/>
				</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	.focus-ballot-intro {
		margin: 0;
		font-size: 1rem;
		line-height: 1.5;
		color: var(--color-text-muted);
	}

	.focus-readiness-section {
		background: color-mix(in srgb, var(--color-primary, #3b82f6) 4%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-primary, #3b82f6) 15%, var(--line));
		border-radius: var(--radius-lg);
		padding: 0;
		overflow: hidden;
		transition: all 0.3s ease;
	}
	.focus-readiness-section.phase-closing {
		background: color-mix(in srgb, var(--color-warning, #f59e0b) 6%, transparent);
		border-color: color-mix(in srgb, var(--color-warning, #f59e0b) 30%, var(--line));
	}
	.focus-readiness-section.phase-final {
		background: color-mix(in srgb, var(--color-success, #10b981) 6%, transparent);
		border-color: color-mix(in srgb, var(--color-success, #10b981) 30%, var(--line));
	}

	.focus-explainer-toggle {
		display: flex;
		align-items: center;
		width: 100%;
		padding: 0.75rem 1rem;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--ink);
		font-weight: 600;
		font-size: 0.95rem;
		text-align: left;
	}

	.focus-explainer-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-primary, #3b82f6);
		margin-right: 0.5rem;
	}
	.phase-closing .focus-explainer-icon {
		color: var(--color-warning, #f59e0b);
	}
	.phase-final .focus-explainer-icon {
		color: var(--color-success, #10b981);
	}

	.focus-explainer-title {
		flex: 1;
	}

	.focus-explainer-chevron {
		display: flex;
		align-items: center;
		color: var(--muted);
		transition: transform 0.2s;
	}
	.focus-explainer-chevron.open {
		transform: rotate(180deg);
	}

	.focus-explainer-body {
		padding: 0 1rem 1rem 2.5rem;
		font-size: 0.9rem;
		line-height: 1.5;
		color: var(--ink);
		opacity: 0.9;
	}

	.feed-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.ballot-list {
		margin: 0;
		gap: 0.8rem;
		background: var(--color-bg-secondary, #fafafa);
		padding: 1rem;
		border-radius: 12px;
		border: 1px solid var(--color-border);
		box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.02);
		box-sizing: border-box;
		overflow: hidden;
	}

	.ballot-rank-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.ballot-rank-num {
		font-size: 1.15rem;
		font-weight: 800;
		color: var(--ink, #111);
		min-width: 1.5rem;
		text-align: right;
		flex-shrink: 0;
		line-height: 1;
	}

	.ballot-rank-row:nth-child(2) .ballot-rank-num {
		opacity: 0.85;
	}
	.ballot-rank-row:nth-child(3) .ballot-rank-num {
		opacity: 0.65;
		font-size: 1rem;
	}
	.ballot-rank-row:nth-child(n + 4) .ballot-rank-num {
		opacity: 0.45;
		font-size: 0.9rem;
	}

	.ballot-rank-row > :global(.pc-card) {
		flex: 1;
		min-width: 0;
	}

	.empty-state {
		text-align: center;
		padding: 2rem 1rem;
		color: var(--color-text-muted);
		background: var(--color-bg-secondary);
		border-radius: var(--radius-lg);
		border: 1px dashed var(--color-border);
	}
</style>
