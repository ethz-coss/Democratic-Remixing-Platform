<script lang="ts">
	import { enhance } from '$app/forms';
	import { localizePath } from '$lib/utils/i18n-path';
	import * as T from '$lib/utils/terminology';
	import * as m from '$lib/paraglide/messages.js';
	import { voteState } from '$lib/stores/voteState.svelte';
	import { untrack } from 'svelte';

	interface Props {
		questionId?: string;
		targetId?: string;
		idFieldName?: string;
		subjectLabel?: string;
		action: string;
		subscriptionCount?: number;
		userVote?: number;
		canVote: boolean;
		/** Visual variant: 'default' (inline) or 'detail' (full-width CTA) */
		variant?: 'default' | 'detail';
		/** Compact mode: hide the text label, show only icon + count */
		compact?: boolean;
		/**
		 * Called after a successful server response with the confirmed values.
		 * Use this to mirror the server-confirmed state into any parent-level
		 * display (e.g. a score label or cluster standings counter).
		 */
		onVoteSuccess?: (subscriptionCount: number, userVote: number) => void;
	}

	let {
		questionId,
		targetId,
		idFieldName = 'questionId',
		subjectLabel = 'question',
		action,
		subscriptionCount = 0,
		userVote = 0,
		canVote,
		variant = 'default',
		compact = false,
		onVoteSuccess
	}: Props = $props();

	// ── Mode detection ────────────────────────────────────────────────────
	// Proposal votes use the shared store; question votes use local state.
	const isProposalVote = $derived(idFieldName === 'proposalId');
	const resolvedTargetId = $derived(targetId ?? questionId ?? '');

	// ── Local state (question votes only) ──────────────────────────────────
	let localSubscriptionCount = $state(untrack(() => subscriptionCount));
	let localUserVote = $state(untrack(() => userVote));

	// ── Display state: reads from store (proposals) or local (questions) ───
	const displaySubscriptionCount = $derived(
		isProposalVote ? voteState.getSubscriptionCount(resolvedTargetId) : localSubscriptionCount
	);
	const displayUserVote = $derived(
		isProposalVote ? voteState.getUserVote(resolvedTargetId) : localUserVote
	);
	let pendingSubmissions = 0;
	let latestSubmissionId = 0;
	let baselineSubscriptionCount = untrack(() => subscriptionCount);
	let baselineUserVote = untrack(() => userVote);

	// Track prop changes for question votes only
	let prevSubscriptionCountProp = untrack(() => subscriptionCount);
	let prevUserVoteProp = untrack(() => userVote);

	$effect(() => {
		if (isProposalVote) return; // Store handles proposal votes
		const sc = subscriptionCount;
		const uv = userVote;
		if (sc === prevSubscriptionCountProp && uv === prevUserVoteProp) return;
		prevSubscriptionCountProp = sc;
		prevUserVoteProp = uv;
		if (pendingSubmissions === 0) {
			localSubscriptionCount = sc;
			localUserVote = uv;
		}
	});

	// ── Resolve the question ID ────────────────────────────────────────────
	// Most proposal callers embed it in the action URL: /questions/{id}/proposals?/vote
	const resolvedQuestionId = $derived.by(() => {
		if (questionId) return questionId;
		const match = action.match(/\/questions\/([^/]+)\//);
		return match?.[1] ?? '';
	});

	// ── Proposal vote handler (store-backed) ──────────────────────────────
	function handleProposalVote() {
		if (!canVote || !resolvedTargetId || !resolvedQuestionId) return;
		voteState.submitVote(resolvedTargetId, resolvedQuestionId, onVoteSuccess);
	}
</script>

<div class="vote-wrap" class:vote-detail={variant === 'detail'} class:vote-compact={compact}>
	{#if canVote}
		{#if isProposalVote}
			<!-- Proposal votes: store-backed button (no form needed) -->
			<div class="vote-row">
				<button
					type="button"
					class="btn-vote"
					class:active-support={displayUserVote === 1}
					onclick={handleProposalVote}
					aria-label={displayUserVote === 1
						? m.vote_retract_aria({ subject: subjectLabel })
						: m.vote_support_aria({ subject: subjectLabel })}
				>
					<span class="icon-wrapper">
						<T.ICON_SUBSCRIBE size={14} class="inline-icon" />
					</span>
					{#if !compact}{displayUserVote === 1 ? m.vote_supported() : m.vote_support()}{/if}
					<span class="count-badge count-support">{displaySubscriptionCount}</span>
				</button>
			</div>
		{:else}
			<!-- Question votes: legacy form-based -->
			<form
				method="POST"
				{action}
				use:enhance={({ formData }) => {
					const currentSubmissionId = ++latestSubmissionId;
					if (pendingSubmissions === 0) {
						baselineSubscriptionCount = localSubscriptionCount;
						baselineUserVote = localUserVote;
					}
					pendingSubmissions++;

					const nextVote = localUserVote === 1 ? 0 : 1;
					formData.set('vote', String(nextVote));

					// Optimistic update
					if (localUserVote === 1) localSubscriptionCount = Math.max(0, localSubscriptionCount - 1);
					if (nextVote === 1) localSubscriptionCount++;
					localUserVote = nextVote;

					return async ({ result }) => {
						pendingSubmissions--;
						prevSubscriptionCountProp = subscriptionCount;
						prevUserVoteProp = userVote;

						if (currentSubmissionId === latestSubmissionId) {
							if (result.type === 'success') {
								const data = result.data as any;
								if (typeof data.subscriptionCount === 'number')
									localSubscriptionCount = data.subscriptionCount;
								if (typeof data.userVote === 'number') localUserVote = data.userVote;
								onVoteSuccess?.(localSubscriptionCount, localUserVote);
							} else if (result.type === 'failure' || result.type === 'error') {
								localSubscriptionCount = baselineSubscriptionCount;
								localUserVote = baselineUserVote;
							}
						}
					};
				}}
			>
				<input type="hidden" name={idFieldName} value={resolvedTargetId} />
				<div class="vote-row">
					<button
						type="submit"
						name="vote"
						value={displayUserVote === 1 ? '0' : '1'}
						class="btn-vote"
						class:active-support={displayUserVote === 1}
						aria-label={displayUserVote === 1
							? m.vote_retract_aria({ subject: subjectLabel })
							: m.vote_support_aria({ subject: subjectLabel })}
					>
						<span class="icon-wrapper">
							<T.ICON_SUBSCRIBE size={14} class="inline-icon" />
						</span>
						{#if !compact}{displayUserVote === 1 ? m.vote_supported() : m.vote_support()}{/if}
						<span class="count-badge count-support">{displaySubscriptionCount}</span>
					</button>
				</div>
			</form>
		{/if}
	{:else}
		<div class="vote-row" aria-live="polite">
			<a href={localizePath('/login')} class="muted">{m.auth_login_to_vote()}</a>
			<div class="static-counts">
				<span class="count-badge count-support"
					><T.ICON_SUBSCRIBE size={14} class="inline-icon" /> {displaySubscriptionCount}</span
				>
			</div>
		</div>
	{/if}
</div>

<style>
	.vote-wrap {
		display: inline-flex;
	}

	.vote-wrap.vote-detail {
		display: flex;
		width: 100%;
	}

	.vote-detail .vote-row {
		width: 100%;
	}

	.vote-detail form {
		width: 100%;
	}

	.vote-detail button.btn-vote {
		width: 100%;
		min-height: var(--touch-min, 44px);
		font-size: 0.9rem;
		border-radius: 8px;
	}

	.vote-row {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
	}

	button.btn-vote {
		width: auto;
		min-width: 2.75rem;
		height: var(--touch-min, 44px);
		padding: 0 0.65rem;
		display: inline-flex;
		gap: 0.3rem;
		justify-content: center;
		align-items: center;
		border-radius: var(--radius-sm, 6px);
		border: 1px solid var(--line);
		background: white;
		cursor: pointer;
		font-weight: 600;
		font-size: 0.85rem;
		line-height: 1;
		color: var(--ink);
		transition: all 0.2s ease;
	}

	/* Compact mode: no text label, just icon + count — tighter padding */
	.vote-wrap.vote-compact button.btn-vote {
		min-width: 2.25rem;
		height: 36px;
		padding: 0 0.5rem;
		font-size: 0.8rem;
	}

	button.btn-vote .icon-wrapper {
		font-size: 1.1rem;
	}

	button:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	button.btn-vote.active-support {
		border-color: var(--success, #16a34a);
		color: white;
		background: var(--success, #16a34a);
	}

	.count-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.1rem 0.4rem;
		border-radius: 1rem;
		font-size: 0.75rem;
		font-weight: 700;
		background: var(--bg-tertiary, #f3f4f6);
		color: var(--ink);
		margin-left: 0.2rem;
	}

	button.btn-vote.active-support .count-badge {
		background: rgba(255, 255, 255, 0.2);
		color: white;
	}

	.static-counts {
		display: inline-flex;
		gap: 0.5rem;
	}
</style>
