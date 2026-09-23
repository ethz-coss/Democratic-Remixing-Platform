import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	buildQuestionScoreMap,
	deriveQuestionState,
	escapeFilter,
	getPocketBaseErrorMessage,
	normalizeQuestionRecord,
	parseVoteValue,
	submitQuestionVote,
	countVotesForQuestion
} from '$lib/server/questions';
import { localizePath } from '$lib/utils/i18n-path.js';

function normalizeTimelinePhase(
	rawPhase: unknown
): App.QuestionTimelineEventRecord['phase'] | null {
	const phase = String(rawPhase ?? '').trim();
	// Canonical phases
	if (phase === 'Proposed' || phase === 'AnswerSearch' || phase === 'Voting') {
		return phase;
	}

	// Legacy backward compat: map old phase names
	if (
		phase === 'Ideation' ||
		phase === 'Mapping' ||
		phase === 'Exploration' ||
		phase === 'Selection' ||
		phase === 'Structure'
	) {
		return 'AnswerSearch';
	}

	if (phase === 'FinalReproposal' || phase === 'FinalResolution') {
		return 'Voting';
	}

	return null;
}

function buildPhaseTrace(
	question: App.QuestionRecord,
	rawPhases: Record<string, unknown>[]
): string[] {
	const trace: string[] = [`Created (${question.created})`];

	for (const record of rawPhases) {
		const phase = normalizeTimelinePhase(record.phase_name);
		if (!phase) {
			continue;
		}
		const startedAt = String(record.started_at ?? '').trim();
		const stepLabel = startedAt ? `${phase} (${startedAt})` : phase;
		trace.push(stepLabel);
	}

	if (trace.length === 1) {
		trace.push(`${question.current_phase_name} (current)`);
	}

	return trace;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	let rawQuestion;
	try {
		rawQuestion = await locals.pb.collection('questions').getOne(params.id, {
			expand: 'current_phase'
		});
	} catch (err: any) {
		if (err?.status === 404) {
			throw error(404, 'Question not found');
		}
		throw err;
	}
	const baseQuestion = normalizeQuestionRecord(rawQuestion);

	let score = 0;
	try {
		score = await countVotesForQuestion(locals.pb, baseQuestion.id);
	} catch {
		score = 0;
	}

	const question = deriveQuestionState(baseQuestion, score);

	let rawQuestionPhases: Record<string, unknown>[] = [];
	try {
		rawQuestionPhases = (await locals.pb.collection('question_phases').getFullList({
			filter: `question = "${escapeFilter(question.id)}"`,
			sort: '+started_at,+id'
		})) as Record<string, unknown>[];
	} catch {
		rawQuestionPhases = [];
	}

	const phaseTrace = buildPhaseTrace(question, rawQuestionPhases);

	if (
		(question.current_phase_name === 'AnswerSearch' || question.current_phase_name === 'Voting') &&
		locals.user?.role !== 'admin'
	) {
		throw redirect(303, localizePath(`/questions/${question.id}/proposals`));
	}

	let author: { id: string; username?: string; name?: string } | null = null;
	if (question.author) {
		try {
			const authorRecord = await locals.pb.collection('users').getOne(question.author, {
				fields: 'id,username,name'
			});
			author = {
				id: authorRecord.id,
				username: typeof authorRecord.username === 'string' ? authorRecord.username : undefined,
				name: typeof authorRecord.name === 'string' ? authorRecord.name : undefined
			};
		} catch {
			author = null;
		}
	}

	let votes: { user: string; vote: number }[] = [];
	if (locals.user) {
		try {
			votes = (await locals.pb.collection('question_votes').getFullList({
				filter: `question = "${escapeFilter(question.id)}"`,
				fields: 'user,vote'
			})) as unknown as { user: string; vote: number }[];
		} catch {
			votes = [];
		}
	}

	const userVote: number = locals.user
		? (votes.find((vote: { user: string; vote: number }) => vote.user === locals.user?.id)?.vote ?? 0)
		: 0;

	return {
		question,
		author,
		phaseTrace,
		userVote,
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
			voteValue = parseVoteValue(formData.get('vote'));
		} catch (err) {
			return fail(400, {
				message: err instanceof Error ? err.message : 'Vote must be 1 or -1.'
			});
		}

		const questionId = String(formData.get('questionId') ?? params.id).trim();

		if (questionId !== params.id) {
			return fail(400, { message: 'Question id mismatch.' });
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
