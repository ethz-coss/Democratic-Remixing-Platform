import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	buildQuestionScoreMap,
	buildUserVoteMap,
	deriveQuestionState,
	getPocketBaseErrorMessage,
	normalizeQuestionRecord,
	parseVoteValue,
	submitQuestionVote,
	sortQuestionsByScoreAndCreated
} from '$lib/server/questions';

const SHOW_QUESTION_SPACE_UI = false;

export const load: PageServerLoad = async ({ locals }) => {
	if (!SHOW_QUESTION_SPACE_UI) {
		throw redirect(307, '/discourse');
	}

	let rawQuestions: Record<string, unknown>[] = [];
	try {
		rawQuestions = await locals.pb.collection('questions').getFullList();
	} catch {
		rawQuestions = [];
	}

	let voteList: App.QuestionVoteRecord[] = [];
	try {
		voteList = await locals.pb.collection('question_votes').getFullList<App.QuestionVoteRecord>();
	} catch {
		voteList = [];
	}

	const scoreByQuestion = buildQuestionScoreMap(voteList);
	const questions = sortQuestionsByScoreAndCreated(
		rawQuestions
			.map((item) =>
				deriveQuestionState(
					normalizeQuestionRecord(item),
					scoreByQuestion[String(item.id ?? '')] ?? 0
				)
			)
			.filter((question) => question.current_phase_name === 'Proposed')
	);

	const userVotes = locals.user ? buildUserVoteMap(voteList, locals.user.id) : {};

	return {
		questions,
		userVotes,
		user: locals.user
	};
};

export const actions: Actions = {
	vote: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, { message: 'You must be logged in to vote.' });
		}

		const formData = await request.formData();
		let voteValue: number;
		try {
			voteValue = parseVoteValue(formData.get('vote'));
		} catch (err) {
			return fail(400, {
				message: err instanceof Error ? err.message : 'Vote must be 1 or -1.'
			});
		}

		const questionId = String(formData.get('questionId') ?? '').trim();
		if (!questionId) {
			return fail(400, { message: 'Missing question id.' });
		}

		try {
			const nextState = await submitQuestionVote({
				pb: locals.pb,
				userId: locals.user.id,
				questionId,
				voteValue
			});

			return {
				ok: true,
				...nextState
			};
		} catch (err) {
			return fail(400, {
				message: getPocketBaseErrorMessage(err, 'Failed to submit vote.')
			});
		}
	}
};
