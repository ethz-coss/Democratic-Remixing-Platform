<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { localizePath } from '$lib/utils/i18n-path';
	import { stripRichText } from '$lib/markdown';
	import WysiwygMarkdownEditor from './WysiwygMarkdownEditor.svelte';
	import { Trophy, Users, CircleSlash, UserMinus, Info } from '@lucide/svelte';

	let {
		proposals,
		votingSummary,
		questionId,
		fullPage = true
	}: {
		proposals: App.ProposalRecord[];
		votingSummary?: App.VotingSummary;
		questionId: string;
		fullPage?: boolean;
	} = $props();

	// Build a lookup map: proposalId → correctly-encoded title from proposal records.
	// Summary titles may have UTF-8 mojibake from backend byte-slice decoding.
	const titleLookup = $derived(Object.fromEntries(proposals.map((p) => [p.id, p.title])));

	// Use the pre-computed summary if available; otherwise derive minimal info from proposals
	const ranked = $derived(
		votingSummary?.proposals
			? [...votingSummary.proposals].map((p) => ({
					...p,
					title: titleLookup[p.proposalId] || p.title
				}))
			: [...proposals]
					.sort((a, b) => (b.borda_score || 0) - (a.borda_score || 0))
					.map((p) => ({
						proposalId: p.id,
						title: p.title || '',
						bordaScore: p.borda_score || 0,
						maxPossibleScore: 0,
						firstPlaceVotes: 0,
						totalVotes: 0,
						rankDistribution: []
					}))
	);

	const winner = $derived(ranked.length > 0 ? ranked[0] : null);

	// Look up the full proposal record for the winner to get content preview
	const winnerRecord = $derived(winner ? proposals.find((p) => p.id === winner.proposalId) : null);

	const contentPreview = $derived.by(() => {
		if (!winnerRecord?.content) return '';
		const text = stripRichText(winnerRecord.content);
		return text.length > 180 ? text.substring(0, 177) + '…' : text;
	});

	// Participation metrics (from summary or fallback)
	const totalBallots = $derived(votingSummary?.totalBallots ?? 0);
	const activeVotes = $derived(votingSummary?.activeVotes ?? 0);
	const abstentions = $derived(votingSummary?.abstentions ?? 0);
	const eligibleVoters = $derived(votingSummary?.eligibleVoters ?? null);
	const noVotes = $derived(
		eligibleVoters !== null ? Math.max(0, eligibleVoters - totalBallots) : null
	);
	const participationPct = $derived(
		eligibleVoters ? Math.round((totalBallots / eligibleVoters) * 100) : null
	);

	const numChampions = $derived(votingSummary?.numChampions ?? proposals.length);

	// Colors for rank positions (1st, 2nd, 3rd, ...)
	const RANK_COLORS = [
		'var(--rcv-rank1, #22c55e)', // 1st place — green
		'var(--rcv-rank2, #f59e0b)', // 2nd place — amber
		'var(--rcv-rank3, #94a3b8)', // 3rd place — slate
		'var(--rcv-rank4, #cbd5e1)' // 4th+ — light slate
	];

	function rankColor(i: number) {
		return RANK_COLORS[Math.min(i, RANK_COLORS.length - 1)];
	}

	function rankLabel(i: number) {
		const labels = [m.final_result_rank_1(), m.final_result_rank_2(), m.final_result_rank_3()];
		return labels[i] ?? m.final_result_rank_nth({ n: i + 1 });
	}

	function barPct(score: number, max: number): number {
		if (!max || max === 0) return 0;
		return Math.round((score / max) * 100);
	}

	// For a stacked bar: compute segment widths as % of maxPossibleScore
	function segments(p: App.VotingProposalSummary): { pct: number; color: string; label: string }[] {
		if (!p.rankDistribution || p.rankDistribution.length === 0 || !p.maxPossibleScore) {
			// Fallback: single bar showing borda score
			return [
				{
					pct: barPct(p.bordaScore, p.maxPossibleScore || p.bordaScore || 1),
					color: rankColor(0),
					label: ''
				}
			];
		}
		return p.rankDistribution
			.map((count, i) => {
				const pts = count * (numChampions - i); // points this rank contributed
				return {
					pct: barPct(pts, p.maxPossibleScore),
					color: rankColor(i),
					label: rankLabel(i)
				};
			})
			.filter((s) => s.pct > 0);
	}
</script>

<div class="vr-root">
	<!-- ══ WINNER HERO CARD ══════════════════════════════════════════════════ -->
	{#if winner}
		<div class="winner-card">
			<div class="winner-badge">
				<Trophy size={16} strokeWidth={2.5} />
				<span>{m.final_result_winning_solution()}</span>
			</div>
			<a
				href={localizePath(`/questions/${questionId}/proposals/${winner.proposalId}`)}
				class="winner-link"
			>
				<h2 class="winner-title">{winnerRecord?.title || winner.title}</h2>
				{#if fullPage && winnerRecord?.content}
					<!-- Full results page: render rich text content -->
					<div class="winner-full-content" style="pointer-events: none;">
						<WysiwygMarkdownEditor html={winnerRecord.content} editable={false} />
					</div>
				{:else if contentPreview}
					<p class="winner-preview">{contentPreview}</p>
				{/if}
			</a>
			{#if winner.maxPossibleScore > 0}
				<div class="winner-score-line">
					<span class="score-number">{winner.bordaScore}</span>
					<span class="score-sep">/</span>
					<span class="score-max">{winner.maxPossibleScore}</span>
					<span class="score-label">{m.final_result_borda_points()}</span>
					{#if winner.firstPlaceVotes > 0}
						<span class="score-first"
							>· {winner.firstPlaceVotes} {m.final_result_first_choice()}</span
						>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	<!-- ══ RANKED BAR CHART ══════════════════════════════════════════════════ -->
	{#if ranked.length > 0}
		<div class="chart-section">
			<h3 class="chart-heading">{m.final_result_all_proposals()}</h3>

			<!-- Legend (only when we have rank distribution data) -->
			{#if !votingSummary?._fallback && numChampions > 0}
				<div class="legend-row" aria-label="Legend for bar segments">
					{#each Array.from({ length: Math.min(numChampions, 3) }, (_, i) => i) as i}
						<span class="legend-item">
							<span class="legend-dot" style="background:{rankColor(i)}"></span>
							{rankLabel(i)}
						</span>
					{/each}
				</div>
			{/if}

			<ol class="bar-list" aria-label="Proposal ranking">
				{#each ranked as p, rank}
					{@const isWinner = rank === 0}
					{@const segs = segments(p)}
					{@const totalPct = segs.reduce((s, seg) => s + seg.pct, 0)}

					<li class="bar-item {isWinner ? 'is-winner' : ''}">
						<a
							href={localizePath(`/questions/${questionId}/proposals/${p.proposalId}`)}
							class="bar-row"
							aria-label="{p.title}: {p.bordaScore} points"
						>
							<span class="bar-rank" aria-hidden="true">{rank + 1}</span>
							<div class="bar-content">
								<span class="bar-title">{p.title}</span>
								<div
									class="bar-track"
									role="meter"
									aria-valuenow={p.bordaScore}
									aria-valuemax={p.maxPossibleScore || p.bordaScore}
								>
									<div class="bar-fill" style="width:{Math.max(totalPct, totalPct > 0 ? 2 : 0)}%">
										{#each segs as seg}
											<span
												class="bar-segment"
												style="width:{(seg.pct / (totalPct || 1)) * 100}%; background:{seg.color}"
												title={seg.label}
											></span>
										{/each}
									</div>
								</div>
								<span class="bar-score">
									{#if p.maxPossibleScore > 0}
										{p.bordaScore}<span class="score-denom">/{p.maxPossibleScore}</span>
									{:else}
										{p.bordaScore} pts
									{/if}
								</span>
							</div>
						</a>
					</li>
				{/each}
			</ol>
		</div>
	{/if}

	<!-- ══ PARTICIPATION METRICS ═════════════════════════════════════════════ -->
	<div class="participation-section">
		<h3 class="participation-heading">
			{m.final_result_participation()}
			{#if participationPct !== null}
				<span class="participation-pct">{participationPct}%</span>
			{/if}
		</h3>
		<div class="stat-pills">
			<div class="stat-pill active">
				<Users size={13} />
				<span>
					<strong>{activeVotes}</strong>
					{m.final_result_votes_cast()}
				</span>
			</div>
			{#if abstentions > 0}
				<div class="stat-pill neutral">
					<CircleSlash size={13} />
					<span>
						<strong>{abstentions}</strong>
						{m.final_result_abstentions()}
					</span>
				</div>
			{/if}
			{#if noVotes !== null && noVotes > 0}
				<div class="stat-pill muted">
					<UserMinus size={13} />
					<span>
						<strong>{noVotes}</strong>
						{m.final_result_no_votes()}
					</span>
				</div>
			{/if}
		</div>
	</div>

	<!-- ══ BORDA EXPLAINER ═══════════════════════════════════════════════════ -->
	{#if numChampions > 1}
		<details class="explainer">
			<summary class="explainer-trigger">
				<Info size={13} />
				{m.final_result_how_scoring_works()}
			</summary>
			<p class="explainer-body">
				{m.final_result_borda_explanation({ n: numChampions })}
			</p>
		</details>
	{/if}
</div>

<style>
	/* ── Root ──────────────────────────────────────────────────────────────── */
	.vr-root {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	/* ── Winner Card ─────────────────────────────────────────────────────── */
	.winner-card {
		background: color-mix(in srgb, var(--success, #22c55e) 8%, var(--paper, #fff));
		border: 1.5px solid color-mix(in srgb, var(--success, #22c55e) 40%, transparent);
		border-radius: 12px;
		padding: 1.1rem 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.winner-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--success, #16a34a);
	}

	.winner-link {
		text-decoration: none;
		color: inherit;
	}
	.winner-link:hover .winner-title {
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.winner-title {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
		line-height: 1.35;
		color: var(--ink, #111);
	}

	.winner-preview {
		margin: 0.25rem 0 0;
		font-size: 0.83rem;
		color: var(--muted, #5a5a5a);
		line-height: 1.5;
		display: -webkit-box;
		line-clamp: 3;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.winner-score-line {
		display: flex;
		align-items: baseline;
		gap: 0.2rem;
		font-size: 0.82rem;
		color: var(--muted, #5a5a5a);
		margin-top: 0.1rem;
	}

	.score-number {
		font-weight: 700;
		color: var(--success, #16a34a);
		font-size: 1rem;
	}

	.score-sep,
	.score-max {
		color: var(--muted, #aaa);
	}

	.score-label {
		color: var(--muted, #5a5a5a);
	}

	.score-first {
		color: var(--muted, #5a5a5a);
		margin-left: 0.3rem;
	}

	/* ── Chart Section ───────────────────────────────────────────────────── */
	.chart-section {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.chart-heading {
		margin: 0;
		font-size: 0.8rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted, #888);
	}

	/* Legend */
	.legend-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
	}

	.legend-item {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.73rem;
		color: var(--muted, #666);
	}

	.legend-dot {
		width: 8px;
		height: 8px;
		border-radius: 2px;
		flex-shrink: 0;
	}

	/* Bar list */
	.bar-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.bar-item {
		border-radius: 8px;
		overflow: hidden;
		transition: background 0.15s;
	}

	.bar-item.is-winner .bar-row {
		background: color-mix(in srgb, var(--success, #22c55e) 5%, var(--paper, #fff));
	}

	.bar-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.55rem 0.6rem;
		border-radius: 8px;
		border: 1px solid var(--line, #e5e7eb);
		background: var(--paper, #fff);
		text-decoration: none;
		color: inherit;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}

	.bar-row:hover {
		border-color: var(--primary, #6366f1);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.07);
	}

	.bar-rank {
		flex-shrink: 0;
		width: 1.4rem;
		height: 1.4rem;
		border-radius: 50%;
		background: var(--surface, #f3f4f6);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--ink, #111);
	}

	.bar-item.is-winner .bar-rank {
		background: var(--success, #22c55e);
		color: white;
	}

	.bar-content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.bar-title {
		font-size: 0.83rem;
		font-weight: 600;
		color: var(--ink, #111);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.bar-track {
		height: 10px;
		border-radius: 5px;
		background: var(--line, #e5e7eb);
		overflow: hidden;
		position: relative;
	}

	.bar-fill {
		height: 100%;
		border-radius: 5px;
		display: flex;
		overflow: hidden;
		transition: width 0.4s ease;
	}

	.bar-segment {
		display: block;
		height: 100%;
		transition: width 0.4s ease;
	}

	.bar-score {
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--ink, #333);
		white-space: nowrap;
		align-self: flex-end;
	}

	.score-denom {
		font-weight: 400;
		color: var(--muted, #aaa);
	}

	/* ── Participation ───────────────────────────────────────────────────── */
	.participation-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--line, #e5e7eb);
	}

	.participation-heading {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted, #888);
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.participation-pct {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--ink, #222);
		text-transform: none;
		letter-spacing: 0;
	}

	.stat-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.stat-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.28rem 0.65rem;
		border-radius: 20px;
		font-size: 0.78rem;
		border: 1px solid transparent;
	}

	.stat-pill strong {
		font-weight: 700;
	}

	.stat-pill.active {
		background: color-mix(in srgb, var(--success, #22c55e) 10%, transparent);
		border-color: color-mix(in srgb, var(--success, #22c55e) 30%, transparent);
		color: var(--success-dark, #15803d);
	}

	.stat-pill.neutral {
		background: color-mix(in srgb, var(--warning, #f59e0b) 10%, transparent);
		border-color: color-mix(in srgb, var(--warning, #f59e0b) 30%, transparent);
		color: var(--warning-dark, #b45309);
	}

	.stat-pill.muted {
		background: var(--surface, #f3f4f6);
		border-color: var(--line, #e5e7eb);
		color: var(--muted, #666);
	}

	/* ── Explainer ───────────────────────────────────────────────────────── */
	.explainer {
		font-size: 0.8rem;
		color: var(--muted, #666);
	}

	.explainer-trigger {
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		list-style: none;
		color: var(--muted, #888);
		font-size: 0.78rem;
	}

	.explainer-trigger::-webkit-details-marker {
		display: none;
	}

	.explainer-trigger:hover {
		color: var(--ink, #333);
	}

	.explainer-body {
		margin: 0.5rem 0 0 1.5rem;
		line-height: 1.6;
		color: var(--muted, #555);
	}
</style>
