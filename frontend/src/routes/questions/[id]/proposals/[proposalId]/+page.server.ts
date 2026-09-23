import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ClientResponseError } from 'pocketbase';
import {
	buildProposalScoreMap,
	buildUserProposalVoteMap,
	normalizeProposalRecord,
	parseProposalVoteValue,
	submitProposalVote
} from '$lib/server/proposals';
import {
	buildQuestionScoreMap,
	deriveQuestionState,
	escapeFilter,
	normalizeQuestionRecord,
	getPocketBaseErrorMessage
} from '$lib/server/questions';
import { stripRichText } from '$lib/markdown';
import { localizePath } from '$lib/utils/i18n-path.js';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const rawQuestion = await locals.pb.collection('questions').getOne(params.id, {
		expand: 'current_phase'
	});
	let questionVotes: App.QuestionVoteRecord[] = [];
	try {
		questionVotes = await locals.pb
			.collection('question_votes')
			.getFullList<App.QuestionVoteRecord>({
				filter: `question = "${escapeFilter(params.id)}"`
			});
	} catch {
		questionVotes = [];
	}

	const scoreByQuestion = buildQuestionScoreMap(questionVotes);
	const question = deriveQuestionState(
		normalizeQuestionRecord(rawQuestion),
		scoreByQuestion[params.id] ?? 0
	);

	const rawProposal = (await locals.pb.collection('proposals').getOne(params.proposalId, {
		expand: 'author'
	})) as Record<string, unknown>;
	const proposal = normalizeProposalRecord(rawProposal);

	if (proposal.question !== params.id) {
		throw redirect(303, localizePath(`/questions/${params.id}/proposals`));
	}

	let proposalVotes: App.ProposalVoteRecord[] = [];
	try {
		proposalVotes = await locals.pb
			.collection('proposal_votes')
			.getFullList<App.ProposalVoteRecord>({
				filter: `proposal = "${escapeFilter(proposal.id)}"`
			});
	} catch {
		proposalVotes = [];
	}

	const scoreByProposal = buildProposalScoreMap(proposalVotes);

	// Hydrate with authoritative vote counts from actual vote records
	const hydratedProposal = proposal;

	const userProposalVotes = locals.user
		? buildUserProposalVoteMap(proposalVotes, locals.user.id)
		: {};

	let compareProposal = null;
	const compareId = url.searchParams.get('compare');
	if (compareId) {
		try {
			const rawCompare = (await locals.pb.collection('proposals').getOne(compareId, {
				expand: 'author'
			})) as Record<string, unknown>;
			compareProposal = normalizeProposalRecord(rawCompare);
		} catch (e) {
			console.warn('Failed to load compare proposal', e);
		}
	}

	return {
		question,
		proposal: hydratedProposal,
		compareProposal,
		userVote: userProposalVotes[proposal.id] ?? 0,
		user: locals.user
	};
};

export const actions: Actions = {
	vote: async ({ request, locals, params }) => {
		if (!locals.user) {
			return fail(401, { message: 'You must be logged in to vote.' });
		}

		const formData = await request.formData();
		let voteValue: number;
		try {
			voteValue = parseProposalVoteValue(formData.get('vote'));
		} catch (err) {
			return fail(400, {
				message: err instanceof Error ? err.message : 'Vote must be 1 or -1.'
			});
		}

		const simulatedAt = formData.get('simulated_at')?.toString();
		const occurredAt = simulatedAt ? new Date(simulatedAt).toISOString() : undefined;

		try {
			const result = await submitProposalVote({
				pb: locals.pb,
				userId: locals.user.id,
				proposalId: params.proposalId,
				questionId: params.id,
				voteValue,
				occurredAt
			});

			const actionType = voteValue > 0 ? 'subscribe' : 'unsubscribe';
			await locals.pb
				.collection('action_logs')
				.create({
					question: params.id,
					user: locals.user.id,
					action_type: actionType,
					target_id: params.proposalId,
					occurred_at: occurredAt || new Date().toISOString()
				})
				.catch((e) => console.error('[action_logs] failed to log vote', e));

			return {
				ok: true,
				...result
			};
		} catch (err) {
			return fail(400, {
				message: getPocketBaseErrorMessage(err, 'Failed to submit vote.')
			});
		}
	}
};
