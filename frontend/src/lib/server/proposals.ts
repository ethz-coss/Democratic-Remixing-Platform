import { error } from '@sveltejs/kit';
import type PocketBase from 'pocketbase';
import { normalizeQuestionRecord } from '$lib/server/questions';
import { escapeFilter } from '$lib/server/questions';
import {
	buildScoreMap,
	buildUserVoteMap,
	normalizeVoteValue,
	parseVoteValue,
	toNumber
} from '$lib/server/vote-utils';
import { normalizeSingleRelation, normalizeRelationIds } from '$lib/server/normalize';

export function normalizeProposalRecord(record: Record<string, unknown>): App.ProposalRecord {
	const rawState = String(record.state ?? 'Proposed');
	const state: App.ProposalRecord['state'] =
		rawState === 'FinalWinner'
			? 'FinalWinner'
			: rawState === 'Deactivated'
				? 'Deactivated'
				: rawState === 'Inactive'
					? 'Inactive'
					: 'Proposed';

	return {
		id: String(record.id ?? ''),
		question: normalizeSingleRelation(record.question),
		author: normalizeSingleRelation(record.author),
		author_name: getExpandedAuthorName(record),
		title: String(record.title ?? '').trim() || 'Untitled proposal',
		content: String(record.content ?? ''),
		reason_for_change: String(record.reason_for_change ?? ''),
		parent_proposals: normalizeRelationIds(record.parent_proposals),
		root_proposal: normalizeSingleRelation(record.root_proposal),
		branch_parent: normalizeSingleRelation(record.branch_parent),
		branch_depth: Math.max(0, Math.round(toNumber(record.branch_depth, 0))),
		state,
		subscription_count: Math.max(0, Math.round(toNumber(record.subscription_count, 0))),
		in_focus: Boolean(record.in_focus),
		labels: normalizeRelationIds(record.labels),
		primary_label: normalizeSingleRelation(record.primary_label),
		is_champion: Boolean(record.is_champion),
		created: String(record.created ?? ''),
		updated: String(record.updated ?? '')
	};
}

function getExpandedAuthorName(record: Record<string, unknown>): string {
	const expand =
		record.expand && typeof record.expand === 'object'
			? (record.expand as Record<string, unknown>)
			: null;
	const author =
		expand?.author && typeof expand.author === 'object'
			? (expand.author as Record<string, unknown>)
			: null;

	const name = typeof author?.name === 'string' ? author.name.trim() : '';
	if (name) {
		return name;
	}

	const username = typeof author?.username === 'string' ? author.username.trim() : '';
	if (username) {
		return username;
	}

	return '';
}

export function parseProposalVoteValue(raw: FormDataEntryValue | null): number {
	return parseVoteValue(raw);
}

export function buildProposalScoreMap(votes: App.ProposalVoteRecord[]) {
	return buildScoreMap(votes, (vote) => vote.proposal);
}

export function buildUserProposalVoteMap(votes: App.ProposalVoteRecord[], userId: string) {
	return buildUserVoteMap(votes, userId, (vote) => vote.proposal);
}

async function listVotesForUserProposal(pb: PocketBase, userId: string, proposalId: string) {
	return pb.collection('proposal_votes').getFullList<App.ProposalVoteRecord>({
		filter: `user="${escapeFilter(userId)}" && proposal="${escapeFilter(proposalId)}"`
	});
}

async function countVotesForProposal(pb: PocketBase, proposalId: string) {
	const result = await pb.collection('proposal_votes').getList(1, 1, {
		filter: `proposal="${escapeFilter(proposalId)}" && vote>0`,
		$autoCancel: false
	});
	return result.totalItems;
}

export interface SubmitProposalVoteInput {
	pb: PocketBase;
	userId: string;
	proposalId: string;
	questionId: string;
	voteValue: number;
	occurredAt?: string;
}

export interface SubmitProposalVoteResult {
	userVote: number;
	subscriptionCount: number;
}

export async function submitProposalVote({
	pb,
	userId,
	proposalId,
	questionId,
	voteValue,
	occurredAt
}: SubmitProposalVoteInput): Promise<SubmitProposalVoteResult> {
	const clampedVote = voteValue === 1 ? 1 : 0;

	const rawProposal = (await pb.collection('proposals').getOne(proposalId)) as Record<
		string,
		unknown
	>;
	const proposal = normalizeProposalRecord(rawProposal);

	if (proposal.question !== questionId) {
		throw error(400, 'Proposal does not belong to this question.');
	}

	const currentQuestion = normalizeQuestionRecord(
		await pb.collection('questions').getOne(questionId)
	);
	if (currentQuestion.current_phase_name === 'Voting') {
		throw error(400, 'Voting is closed. This question is in the Final Vote phase.');
	}

	if (proposal.state === 'FinalWinner') {
		throw error(400, 'Cannot vote on a final winner.');
	}

	const existingVotes = await listVotesForUserProposal(pb, userId, proposalId);
	const previousVote = normalizeVoteValue(existingVotes[0]?.vote ?? 0);
	let nextVote: number = clampedVote;

	if (existingVotes.length === 0) {
		if (clampedVote !== 0) {
			await pb.collection('proposal_votes').create({
				user: userId,
				proposal: proposalId,
				question: questionId,
				vote: clampedVote,
				...(occurredAt ? { occurred_at: occurredAt } : {})
			});
			nextVote = clampedVote;
		} else {
			nextVote = 0;
		}
	} else {
		const existingVote = existingVotes[0];
		const currentVote = normalizeVoteValue(existingVote.vote);

		if (clampedVote === 0 || currentVote === clampedVote) {
			// Retract the vote. Use UPDATE(vote=0) rather than DELETE because
			// PocketBase rejects deletes on proposal_votes when another collection
			// holds a required relation reference to the record. The migrateVote
			// action already uses this same pattern for the same reason.
			// Vote=0 records score zero in all counting queries (SUM CASE WHEN
			// vote=1 THEN 1 ELSE 0 END), so leaving them is semantically correct.
			await pb.collection('proposal_votes').update(existingVote.id, { vote: 0 });
			nextVote = 0;
		} else {
			try {
				await pb.collection('proposal_votes').update(existingVote.id, {
					user: userId,
					proposal: proposalId,
					question: questionId,
					vote: clampedVote,
					...(occurredAt ? { occurred_at: occurredAt } : {})
				});
				nextVote = clampedVote;
			} catch (e: any) {
				console.error('[submitProposalVote] UPDATE FAILED', JSON.stringify(e.response, null, 2), e);
				throw e;
			}
		}
	}

	let subscriptionCount = 0;

	try {
		subscriptionCount = await countVotesForProposal(pb, proposalId);
	} catch {
		// Fallback: compute from what we know
		if (nextVote === 1) subscriptionCount = 1;
	}

	return {
		userVote: nextVote,
		subscriptionCount
	};
}
