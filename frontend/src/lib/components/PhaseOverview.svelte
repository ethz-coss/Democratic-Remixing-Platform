<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import PhaseTimeline from './PhaseTimeline.svelte';
	import { localizePath } from '$lib/utils/i18n-path';
	import { untrack } from 'svelte';
	import {
		BookOpen,
		Lightbulb,
		BellRing,
		ListChecks,
		Trophy,
		ChevronRight,
		ChevronDown
	} from '@lucide/svelte';
	import { formatSwissDate } from '$lib/utils/time';

	interface Props {
		question: App.QuestionRecord;
		now: number;
		hasVoted?: boolean;
		championProposals?: any[];
	}

	let { question, now, hasVoted, championProposals = [] }: Props = $props();

	let selectedPhase = $state<string | null>(untrack(() => question.current_phase_name));
	let detailsOpen = $state(false);

	function formatDate(dateStr: string | null | undefined) {
		if (!dateStr) return undefined;
		return formatSwissDate(dateStr.replace(' ', 'T'));
	}

	const phaseDates = $derived({
		AnswerSearch: { started: formatDate(question?.created) },
		Closing: { started: formatDate(question?.discussion_deadline) },
		Voting: { started: formatDate(question?.closing_window_deadline) },
		Decided: { started: formatDate(question?.vote_deadline) }
	});

	const closingHours = $derived(
		question?.closing_window_deadline
			? Math.max(
					0,
					Math.round(
						(new Date(question.closing_window_deadline.replace(' ', 'T')).getTime() - Date.now()) /
							(1000 * 60 * 60)
					)
				)
			: 24
	);
	const votingHours = $derived(
		question?.vote_deadline
			? Math.max(
					0,
					Math.round(
						(new Date(question.vote_deadline.replace(' ', 'T')).getTime() - Date.now()) /
							(1000 * 60 * 60)
					)
				)
			: question?.discussion_deadline
				? Math.max(
						0,
						Math.round(
							(new Date(question.discussion_deadline.replace(' ', 'T')).getTime() - Date.now()) /
								(1000 * 60 * 60)
						)
					)
				: 72
	);

	function openQuestionPanel() {
		if (typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent('question-panel:open'));
		}
	}

	function getPhaseStatus(phase: string) {
		const phases = ['Proposed', 'AnswerSearch', 'Closing', 'Voting', 'Decided'];
		const currentIdx = phases.indexOf(question.current_phase_name);
		const phaseIdx = phases.indexOf(phase);

		if (currentIdx === phaseIdx) return 'active';
		if (currentIdx > phaseIdx) return 'completed';
		return 'upcoming';
	}

	function getStatusLabel(status: string) {
		if (status === 'active') return m.overview_status_active();
		if (status === 'completed') return m.overview_status_completed();
		return m.overview_status_upcoming();
	}
</script>

<div class="phase-overview">
	<PhaseTimeline
		currentPhase={question.current_phase_name}
		interactive={true}
		{question}
		variant="dashboard"
		bind:selectedPhase
		{phaseDates}
		{now}
	/>

	<div class="phase-detail-card card bg-base-100 theme-{selectedPhase?.toLowerCase()}">
		{#if selectedPhase === 'AnswerSearch'}
			{@const status = getPhaseStatus('AnswerSearch')}
			<div class="phase-header">
				<h3 class="mb-0 text-xl font-bold">{m.overview_answersearch_title()}</h3>
				<div class="phase-meta">
					<span class="status-badge {status}">{getStatusLabel(status)}</span>
					<span class="start-date">{phaseDates.AnswerSearch.started || ''}</span>
				</div>
			</div>

			<!-- Primary CTA: Read the question first -->
			<button class="cta-read-question" onclick={openQuestionPanel}>
				<div class="cta-icon"><BookOpen size={22} /></div>
				<div class="cta-content">
					<span class="cta-label">{m.overview_cta_read_question()}</span>
					<span class="cta-hint">{m.overview_cta_read_question_hint()}</span>
				</div>
				<div class="cta-chevron"><ChevronRight size={20} /></div>
			</button>

			<!-- Collapsible details: description + navigation -->
			<details class="overview-details" bind:open={detailsOpen}>
				<summary class="details-toggle">
					{#if detailsOpen}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
					{detailsOpen ? m.overview_show_less() : m.overview_show_more()}
				</summary>

				<div class="details-body">
					<p class="text-muted mb-6">
						{m.how_it_works_process_discussion_detailed({ readyThreshold: 50 })}
					</p>

					<div class="drawer-tip mb-6">
						<div class="icon-wrapper"><BookOpen size={18} /></div>
						<span class="tip-text">{m.overview_drawer_tip()}</span>
					</div>

					<h4 class="text-muted mb-3 text-sm font-medium">{m.overview_tabs_intro()}</h4>
					<div class="checklist mb-6">
						<a href={localizePath(`/questions/${question.id}/proposals/ideas`)} class="check-item">
							<div class="icon-wrapper"><Lightbulb size={18} /></div>
							<span class="check-text">{m.overview_tab_discover_desc()}</span>
						</a>
						<a
							href={localizePath(`/questions/${question.id}/proposals/subscriptions`)}
							class="check-item"
						>
							<div class="icon-wrapper"><BellRing size={18} /></div>
							<span class="check-text">{m.overview_tab_subscriptions_desc()}</span>
						</a>
					</div>

					{#if status !== 'completed'}
						<div class="transition-tip">
							{m.overview_transition_to_closing()}
						</div>
					{/if}
				</div>
			</details>
		{:else if selectedPhase === 'Closing'}
			{@const status = getPhaseStatus('Closing')}
			<div class="phase-header">
				<h3 class="mb-0 text-xl font-bold">{m.overview_closing_title()}</h3>
				<div class="phase-meta">
					<span class="status-badge {status}">{getStatusLabel(status)}</span>
					<span class="start-date">{phaseDates.Closing.started || ''}</span>
				</div>
			</div>

			<p class="text-muted mb-6">{m.overview_closing_desc_full()}</p>

			<div class="checklist mb-6">
				<a href={localizePath(`/questions/${question.id}/proposals/ballot`)} class="check-item">
					<div class="icon-wrapper"><ListChecks size={18} /></div>
					<span class="check-text">{m.overview_check_review_ballot()}</span>
				</a>
			</div>

			{#if status !== 'completed'}
				<div class="transition-tip">
					{m.overview_transition_to_voting()}
				</div>
			{/if}
		{:else if selectedPhase === 'Voting'}
			{@const status = getPhaseStatus('Voting')}
			<div class="phase-header">
				<h3 class="mb-0 text-xl font-bold">{m.overview_voting_title()}</h3>
				<div class="phase-meta">
					<span class="status-badge {status}">{getStatusLabel(status)}</span>
					<span class="start-date">{phaseDates.Voting.started || ''}</span>
				</div>
			</div>

			{#if status === 'active' && hasVoted}
				<p class="text-muted mb-6">{m.overview_voting_voted_desc()}</p>
			{:else}
				<p class="text-muted mb-6">{m.how_it_works_process_voting_detailed({ votingHours })}</p>
			{/if}

			{#if status === 'active' && !hasVoted}
				<div class="checklist mb-6">
					<a href={localizePath(`/questions/${question.id}/proposals/ballot`)} class="check-item">
						<div class="icon-wrapper"><ListChecks size={18} /></div>
						<span class="check-text">{m.overview_check_vote()}</span>
					</a>
				</div>
				<div class="mb-6">
					<a
						href={localizePath(`/questions/${question.id}/proposals/ballot`)}
						class="signal-btn signal-ready block-btn"
					>
						{m.how_this_phase_works_vote_now()}
					</a>
				</div>
			{/if}

			{#if status !== 'completed'}
				<div class="transition-tip">
					{m.overview_transition_to_decided()}
				</div>
			{/if}
		{:else if selectedPhase === 'Decided'}
			{@const status = getPhaseStatus('Decided')}
			<div class="phase-header">
				<h3 class="mb-0 text-xl font-bold">{m.overview_decided_title()}</h3>
				<div class="phase-meta">
					<span class="status-badge {status}">{getStatusLabel(status)}</span>
					<span class="start-date">{phaseDates.Decided.started || ''}</span>
				</div>
			</div>

			<p class="text-muted mb-6">{m.how_it_works_process_decided_detailed()}</p>

			{#if question.current_phase_name === 'Decided'}
				<!-- Winner teaser: just show the winning title + CTA to full results -->
				{@const winner =
					championProposals.length > 0
						? [...championProposals].sort((a, b) => (b.borda_score ?? 0) - (a.borda_score ?? 0))[0]
						: null}
				<div class="decided-cta">
					{#if winner}
						<div class="decided-winner-teaser">
							<Trophy size={15} style="color: var(--success, #16a34a); flex-shrink:0;" />
							<span class="decided-winner-label">{m.final_result_winning_solution()}:</span>
							<a
								href={localizePath(`/questions/${question.id}/proposals/${winner.id}`)}
								class="decided-winner-title">{winner.title}</a
							>
						</div>
					{/if}
					<a
						href={localizePath(`/questions/${question.id}/proposals/results`)}
						class="view-results-btn"
					>
						<Trophy size={15} />
						{m.final_result_view_full()}
					</a>
				</div>
			{/if}
		{/if}
	</div>
</div>

<style>
	.phase-overview {
		width: 100%;
	}

	/* ── Decided phase CTA (overview shows teaser + link to ballot tab) ── */
	.decided-cta {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin-top: 0.25rem;
	}

	.decided-winner-teaser {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		font-size: 0.85rem;
		flex-wrap: wrap;
	}

	.decided-winner-label {
		font-weight: 600;
		color: var(--success, #16a34a);
		white-space: nowrap;
	}

	.decided-winner-title {
		color: var(--ink, #111);
		font-weight: 500;
		text-decoration: none;
	}
	.decided-winner-title:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.view-results-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 1rem;
		border-radius: 8px;
		background: color-mix(in srgb, var(--success, #22c55e) 12%, transparent);
		border: 1.5px solid color-mix(in srgb, var(--success, #22c55e) 40%, transparent);
		color: var(--success-dark, #15803d);
		font-size: 0.85rem;
		font-weight: 600;
		text-decoration: none;
		transition:
			background 0.15s,
			border-color 0.15s;
		align-self: flex-start;
	}
	.view-results-btn:hover {
		background: color-mix(in srgb, var(--success, #22c55e) 20%, transparent);
		border-color: color-mix(in srgb, var(--success, #22c55e) 60%, transparent);
	}

	.phase-detail-card {
		border: 1px solid var(--line, #ddd);
		border-radius: 12px;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.03);
		padding: 1.5rem;
		transition:
			background-color 0.3s ease,
			border-left-color 0.3s ease;
	}

	@media (max-width: 640px) {
		.phase-detail-card {
			padding: 1rem;
		}
	}

	/* Color Theming */
	.theme-answersearch {
		border-left: 4px solid var(--primary, #4f7df9);
		background-color: color-mix(in srgb, var(--primary) 6%, var(--paper, #fff));
	}
	.theme-closing {
		border-left: 4px solid #eab308;
		background-color: color-mix(in srgb, #eab308 6%, var(--paper, #fff));
	}
	.theme-voting {
		border-left: 4px solid #0ea5e9;
		background-color: color-mix(in srgb, #0ea5e9 6%, var(--paper, #fff));
	}
	.theme-decided {
		border-left: 4px solid #22c55e;
		background-color: color-mix(in srgb, #22c55e 6%, var(--paper, #fff));
	}

	.phase-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 1rem;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.phase-meta {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.25rem;
	}

	.status-badge {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		padding: 0.2rem 0.5rem;
		border-radius: 4px;
	}

	.status-badge.active {
		background-color: var(--primary, #4f7df9);
		color: #fff;
	}
	.status-badge.completed {
		background-color: var(--line, #eee);
		color: var(--muted, #666);
	}
	.status-badge.upcoming {
		background-color: transparent;
		border: 1px solid var(--line, #ddd);
		color: var(--muted, #666);
	}

	.start-date {
		font-size: 0.8rem;
		color: var(--muted, #666);
	}

	.text-muted {
		color: var(--muted, #666);
	}

	.drawer-tip {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		background-color: color-mix(in srgb, var(--ink, #000) 4%, var(--paper, #fff));
		border-radius: 8px;
		font-size: 0.9rem;
	}

	.drawer-tip .icon-wrapper {
		color: var(--ink, #000);
	}

	.transition-tip {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px dashed var(--line, #ddd);
		font-size: 0.9rem;
		color: var(--muted, #666);
		font-style: italic;
	}

	.checklist {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.check-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
		color: inherit;
		text-decoration: none;
	}

	.icon-wrapper {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--primary, #4f7df9);
		flex-shrink: 0;
		width: 24px;
	}

	.check-text {
		font-size: 0.95rem;
		font-weight: 500;
		transition: color 0.2s;
	}

	.check-item:hover .check-text {
		color: var(--primary, #4f7df9);
	}

	.block-btn {
		text-decoration: none;
		width: 100%;
		display: block;
		text-align: center;
		box-sizing: border-box;
	}

	/* ── Primary CTA: Read the question ── */
	.cta-read-question {
		display: flex;
		align-items: center;
		gap: 1rem;
		width: 100%;
		padding: 1rem 1.25rem;
		margin-bottom: 0.75rem;
		background: var(--primary, #4f7df9);
		color: #fff;
		border: none;
		border-radius: 12px;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
		box-shadow: 0 2px 8px color-mix(in srgb, var(--primary, #4f7df9) 30%, transparent);
		transition:
			background 0.2s,
			box-shadow 0.2s,
			transform 0.12s;
	}

	.cta-read-question:hover {
		background: color-mix(in srgb, var(--primary, #4f7df9) 85%, #000);
		box-shadow: 0 4px 16px color-mix(in srgb, var(--primary, #4f7df9) 35%, transparent);
	}

	.cta-read-question:active {
		transform: scale(0.98);
	}

	.cta-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		color: rgba(255, 255, 255, 0.9);
		flex-shrink: 0;
	}

	.cta-content {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		flex: 1;
		min-width: 0;
	}

	.cta-label {
		font-size: 1.05rem;
		font-weight: 700;
		color: #fff;
	}

	.cta-hint {
		font-size: 0.8rem;
		color: rgba(255, 255, 255, 0.8);
		line-height: 1.35;
	}

	.cta-chevron {
		display: flex;
		align-items: center;
		color: rgba(255, 255, 255, 0.7);
		flex-shrink: 0;
		margin-left: auto;
	}

	/* ── Collapsible details ── */
	.overview-details {
		margin-top: 0.25rem;
	}

	.details-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--primary, #4f7df9);
		cursor: pointer;
		padding: 0.45rem 0.85rem;
		list-style: none;
		user-select: none;
		background: color-mix(in srgb, var(--primary, #4f7df9) 8%, var(--paper, #fff));
		border: 1px solid color-mix(in srgb, var(--primary, #4f7df9) 20%, transparent);
		border-radius: 999px;
		transition:
			background 0.15s,
			border-color 0.15s;
	}

	.details-toggle::-webkit-details-marker {
		display: none;
	}

	.details-toggle:hover {
		background: color-mix(in srgb, var(--primary, #4f7df9) 14%, var(--paper, #fff));
		border-color: color-mix(in srgb, var(--primary, #4f7df9) 35%, transparent);
	}

	.details-body {
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid color-mix(in srgb, var(--ink, #111) 8%, transparent);
	}
</style>
