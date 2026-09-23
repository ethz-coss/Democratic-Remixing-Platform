/**
 * voting-engine.ts — Handles Borda count ranking and tallying for the Voting phase.
 */

export type BallotRank = {
	proposalId: string;
	rank: number; // 1 = 1st place, 2 = 2nd place, etc.
};

export type BallotResponse = {
	userId: string;
	questionId: string;
	isAbstention: boolean;
	ranks: BallotRank[];
};

export type ProposalScore = {
	proposalId: string;
	bordaScore: number;
	maxPossibleScore: number;
	firstPlaceVotes: number;
	totalVotes: number;
	/** rankDistribution[i] = number of ballots that ranked this proposal at position i+1 (1-indexed) */
	rankDistribution: number[];
};

export type VotingResults = {
	totalBallots: number;
	abstentions: number;
	/** Number of champion proposals (= length of per-proposal ranking) */
	numChampions: number;
	rankedProposals: ProposalScore[];
};

/**
 * Calculates the Borda count results for a set of ballots.
 * Scoring: n points for 1st place, n-1 for 2nd place, ..., 1 point for last place.
 * Unranked champions receive 0 points.
 * Abstentions count towards total ballots (quorum) but award 0 points.
 * Ties are broken by the number of 1st place votes, then by total votes.
 *
 * The returned `rankDistribution` array has one entry per rank position (1..n),
 * where rankDistribution[i] is the count of ballots that ranked this proposal at
 * position i+1. This enables stacked bar charts showing preference composition.
 */
export function calculateBordaResults(
	ballots: BallotResponse[],
	championIds: string[]
): VotingResults {
	const scores: Record<string, ProposalScore> = {};
	const n = championIds.length;
	const activeVotes = ballots.filter(b => !b.isAbstention).length;

	for (const id of championIds) {
		scores[id] = {
			proposalId: id,
			bordaScore: 0,
			maxPossibleScore: n * activeVotes,
			firstPlaceVotes: 0,
			totalVotes: 0,
			rankDistribution: new Array(n).fill(0)
		};
	}

	let abstentions = 0;

	for (const ballot of ballots) {
		if (ballot.isAbstention) {
			abstentions++;
			continue;
		}

		// Calculate scores based on Borda count
		for (const rank of ballot.ranks) {
			if (!scores[rank.proposalId]) continue; // Ignore ranks for non-champions

			// Points = n - rank + 1
			// Example for 3 champions: 1st = 3, 2nd = 2, 3rd = 1
			const points = n - rank.rank + 1;

			if (points > 0) {
				scores[rank.proposalId].bordaScore += points;
				scores[rank.proposalId].totalVotes++;

				if (rank.rank === 1) {
					scores[rank.proposalId].firstPlaceVotes++;
				}

				// Track rank distribution (0-indexed array, rank 1 → index 0)
				const idx = rank.rank - 1;
				if (idx >= 0 && idx < n) {
					scores[rank.proposalId].rankDistribution[idx]++;
				}
			}
		}
	}

	const rankedProposals = Object.values(scores).sort((a, b) => {
		if (a.bordaScore !== b.bordaScore) {
			return b.bordaScore - a.bordaScore; // Descending score
		}
		if (a.firstPlaceVotes !== b.firstPlaceVotes) {
			return b.firstPlaceVotes - a.firstPlaceVotes; // Descending 1st place
		}
		return b.totalVotes - a.totalVotes; // Descending total votes
	});

	return {
		totalBallots: ballots.length,
		abstentions,
		numChampions: n,
		rankedProposals
	};
}

