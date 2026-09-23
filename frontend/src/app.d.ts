import type PocketBase from 'pocketbase';
import type { AuthUser } from '$lib/server/pb.server';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface QuestionRecord {
			id: string;
			author: string;
			title: string;
			description: string;
			constraints: string[];
			current_phase: string;
			current_phase_name: 'Proposed' | 'AnswerSearch' | 'Closing' | 'Voting' | 'Decided';
			discussion_deadline: string;
			closing_window_deadline?: string;
			vote_deadline?: string;
			focus_quorum: number;
			visibility: 'Public' | 'Group' | 'Private';
			group?: string;
			invite_token?: string;
			/** Computed from question_votes — not stored in DB */
			score: number;
			created: string;
			updated: string;
		}

		interface QuestionPhaseRecord {
			id: string;
			question: string;
			phase_name: 'Proposed' | 'AnswerSearch' | 'Closing' | 'Voting' | 'Decided';
			started_at: string;
			ended_at: string;
			deadline_at: string;
			previous_phase: string | null;
			transition_type: string;
			transition_metadata_json: unknown;
			source_record_id: string;
			created: string;
			updated: string;
		}

		interface QuestionVoteRecord {
			id: string;
			user: string;
			question: string;
			vote: number;
			created: string;
			updated: string;
		}

		interface ProposalRecord {
			id: string;
			question: string;
			author: string;
			author_name: string;
			title: string;
			content: string;
			reason_for_change: string;
			parent_proposals: string[];
			root_proposal: string;
			branch_parent: string;
			branch_depth: number;
			state: 'Proposed' | 'Inactive' | 'FinalWinner' | 'Deactivated';
			/** Number of subscriptions (votes) */
			subscription_count: number;
			/** Borda count score from the final voting phase */
			borda_score?: number;
			/** Whether the idea is in the Focus (top-10 quorum-passing champions) */
			in_focus: boolean;
			/** Whether this proposal is the top-scored node for its primary label */
			is_champion: boolean;
			/** Label IDs associated with this proposal */
			labels: string[];
			/** Primary label ID used for ballot selection */
			primary_label: string;
			created: string;
			updated: string;
		}

		/** Normalized timeline event — derived from question_phases records */
		interface QuestionTimelineEventRecord {
			id: string;
			question: string;
			event_type:
				| 'QuestionCreated'
				| 'ThresholdPassedForSolving'
				| 'ThresholdPassedForVoting'
				| 'VotingPhaseFinished'
				| 'SalvagePhase'
				| 'LoopContinues'
				| 'SingleProposalRemaining'
				| 'RootProposalAdded'
				| 'ProposalBranched'
				| 'PhaseTransition'
				| 'BallotRoundCreated'
				| 'BallotRoundCompleted'
				| 'IdeaDeactivated';
			phase: 'Proposed' | 'AnswerSearch' | 'Closing' | 'Voting' | 'Decided';
			occurred_at: string;
			round: string;
			remaining_proposals: number | null;
			source_record_id: string;
			metadata_json: string;
			created: string;
			updated: string;
		}

		interface ProposalVoteRecord {
			id: string;
			user: string;
			proposal: string;
			/** Denormalized for aggregation */
			question: string;
			/** Binary vote value: 0 (retracted) or +1 (Support) */
			vote: number;
			created: string;
			updated: string;
		}

		interface LabelRecord {
			id: string;
			short_name: string;
			color: string;
			question: string;
			created: string;
			updated: string;
		}

		interface ProposalHideRecord {
			id: string;
			user: string;
			proposal: string;
			created: string;
			updated: string;
		}

		interface BallotResponseRecord {
			id: string;
			user: string;
			question: string;
			ranks: any;
			created: string;
			updated: string;
		}

		/** Per-proposal entry in VotingSummary — anonymous aggregate data */
		interface VotingProposalSummary {
			proposalId: string;
			title: string;
			bordaScore: number;
			maxPossibleScore: number;
			firstPlaceVotes: number;
			totalVotes: number;
			/** rankDistribution[i] = count of ballots that ranked this proposal at position i+1 */
			rankDistribution: number[];
		}

		/**
		 * Pre-computed voting summary stored in questions.voting_summary_json.
		 * Contains only anonymous aggregate data — no individual user votes.
		 */
		interface VotingSummary {
			totalBallots: number;
			activeVotes: number;
			abstentions: number;
			eligibleVoters: number | null;
			numChampions: number | null;
			proposals: VotingProposalSummary[] | null;
			/** True if this was a live fallback count with no rank breakdown */
			_fallback?: boolean;
		}

		interface Locals {
			pb: PocketBase;
			user: AuthUser | null;
		}

		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
