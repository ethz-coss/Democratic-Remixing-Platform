/**
 * voteState.svelte.ts — Shared reactive vote store for proposal votes.
 *
 * Single source of truth for userVote and subscriptionCount across all views
 * (DiscoveryFeed list, DagMap graph, AncestryTrail, CompareSheet, etc.).
 *
 * Usage:
 *   import { voteState } from '$lib/stores/voteState.svelte';
 *   voteState.init(userVotes, proposals);          // from layout data
 *   voteState.getUserVote(proposalId);             // read
 *   voteState.getSupportCount(proposalId);         // read
 *   await voteState.submitVote(proposalId, questionId);  // toggle + POST
 */

// ── Reactive state ──────────────────────────────────────────────────
let userVotes = $state<Record<string, number>>({});
let subscriptionCounts = $state<Record<string, number>>({});

// Proposals that were recently voted on — protected from init() overwrites
// for a grace period to avoid realtime sync clobbering optimistic values.
const recentVotes = new Map<string, number>(); // proposalId → timestamp
const GRACE_PERIOD_MS = 3000;

/**
 * Initialize the store from server data.
 * Called when layout data loads or when realtime invalidation refreshes data.
 * Proposals that were recently voted on are protected from overwrite.
 */
function init(
	serverUserVotes: Record<string, number>,
	proposals: Array<{ id: string; subscription_count?: number }>
) {
	const now = Date.now();
	const nextUserVotes: Record<string, number> = { ...serverUserVotes };
	const nextSubscriptionCounts: Record<string, number> = {};

	for (const p of proposals) {
		nextSubscriptionCounts[p.id] = p.subscription_count ?? 0;
	}

	// Preserve recently-voted proposals (within grace period)
	for (const [proposalId, timestamp] of recentVotes) {
		if (now - timestamp > GRACE_PERIOD_MS) {
			// Grace period expired — let server data through
			recentVotes.delete(proposalId);
			continue;
		}
		// Still within grace period — keep optimistic values
		if (proposalId in userVotes) {
			nextUserVotes[proposalId] = userVotes[proposalId];
		}
		if (proposalId in subscriptionCounts) {
			nextSubscriptionCounts[proposalId] = subscriptionCounts[proposalId];
		}
	}

	userVotes = nextUserVotes;
	subscriptionCounts = nextSubscriptionCounts;
}

/**
 * Read the current user's vote for a proposal. Returns 0 if not voted.
 */
function getUserVote(proposalId: string): number {
	return userVotes[proposalId] ?? 0;
}

/**
 * Read the subscription count for a proposal. Returns 0 if unknown.
 */
function getSubscriptionCount(proposalId: string): number {
	return subscriptionCounts[proposalId] ?? 0;
}

/**
 * Toggle vote on a proposal and POST to the server.
 * Optimistic: immediately updates state, rolls back on failure.
 */
async function submitVote(
	proposalId: string,
	questionId: string,
	onSuccess?: (subscriptionCount: number, userVote: number) => void
): Promise<void> {
	const currentVote = userVotes[proposalId] ?? 0;
	const nextVote = currentVote === 1 ? 0 : 1;

	// Snapshot for rollback
	const prevVote = currentVote;
	const prevSubscription = subscriptionCounts[proposalId] ?? 0;

	// Optimistic update
	userVotes = { ...userVotes, [proposalId]: nextVote };
	subscriptionCounts = {
		...subscriptionCounts,
		[proposalId]: prevSubscription + (nextVote === 1 ? 1 : -1)
	};

	// Mark as recently voted — protect from init() overwrites
	recentVotes.set(proposalId, Date.now());

	try {
		const formData = new FormData();
		formData.set('proposalId', proposalId);
		formData.set('vote', String(nextVote));

		const res = await fetch(`/questions/${questionId}/proposals?/vote`, {
			method: 'POST',
			body: formData
		});

		if (!res.ok) {
			// Rollback on server error
			userVotes = { ...userVotes, [proposalId]: prevVote };
			subscriptionCounts = { ...subscriptionCounts, [proposalId]: prevSubscription };
			recentVotes.delete(proposalId);
		} else {
			// Success — optimistic values are correct, keep them.
			// Refresh the grace period timestamp so realtime sync doesn't
			// overwrite before the server-side score recalculation completes.
			recentVotes.set(proposalId, Date.now());
			onSuccess?.(subscriptionCounts[proposalId] ?? 0, userVotes[proposalId] ?? 0);
		}
	} catch {
		// Rollback on network error
		userVotes = { ...userVotes, [proposalId]: prevVote };
		subscriptionCounts = { ...subscriptionCounts, [proposalId]: prevSubscription };
		recentVotes.delete(proposalId);
	}
}

/**
 * Optimistically remove a vote when a proposal is hidden.
 * The backend will also delete the vote record in the hide hook.
 */
function removeVoteOptimistically(proposalId: string) {
	const currentVote = userVotes[proposalId] ?? 0;
	if (currentVote === 1) {
		const prevSubscription = subscriptionCounts[proposalId] ?? 0;
		userVotes = { ...userVotes, [proposalId]: 0 };
		subscriptionCounts = {
			...subscriptionCounts,
			[proposalId]: prevSubscription - 1
		};
		recentVotes.set(proposalId, Date.now());
	}
}

export const voteState = {
	/** Read the user votes map (reactive) */
	get userVotes() {
		return userVotes;
	},
	/** Read the support counts map (reactive) */
	get subscriptionCounts() {
		return subscriptionCounts;
	},
	init,
	getUserVote,
	getSubscriptionCount,
	submitVote,
	removeVoteOptimistically,
	/** @internal — clears grace period state for testing */
	_resetForTest() {
		recentVotes.clear();
		userVotes = {};
		subscriptionCounts = {};
	}
};
