import type { PageServerLoad } from './$types';
import {
	buildQuestionScoreMap,
	deriveQuestionState,
	normalizeQuestionRecord,
	sortQuestionsByScoreAndCreated
} from '$lib/server/questions';

export const load: PageServerLoad = async ({ locals }) => {
	let rawQuestions: Record<string, unknown>[] = [];
	try {
		rawQuestions = await locals.pb.collection('questions').getFullList({
			expand: 'current_phase'
		});
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
	const allNormalized = rawQuestions.map((item) =>
		deriveQuestionState(normalizeQuestionRecord(item), scoreByQuestion[String(item.id ?? '')] ?? 0)
	);

	// All: everything not decided
	const allQuestions = sortQuestionsByScoreAndCreated(
		allNormalized.filter((q) => q.current_phase_name !== 'Decided')
	);

	// Decided: terminal state
	const decidedQuestions = sortQuestionsByScoreAndCreated(
		allNormalized.filter((q) => q.current_phase_name === 'Decided')
	);

	// Fetch lightweight proposal stats for all relevant questions
	type ProposalStub = { id: string; question: string; primary_label: string; state: string };
	const allRelevantIds = allNormalized.map((p) => p.id);
	const proposalStatsByQuestion: Record<string, { ideaCount: number; clusterCount: number }> = {};
	const activeUsersByQuestion: Record<string, number> = {};

	if (allRelevantIds.length > 0) {
		let allProposals: ProposalStub[] = [];
		try {
			const filter = allRelevantIds.map((id) => `question="${id}"`).join(' || ');
			allProposals = await locals.pb
				.collection('proposals')
				.getFullList<ProposalStub>({ filter, fields: 'id,question,primary_label,state' });
		} catch {
			allProposals = [];
		}

		for (const questionId of allRelevantIds) {
			const forQuestion = allProposals.filter(
				(p) => p.question === questionId && p.state !== 'Deactivated'
			);
			const clusterKeys = new Set(forQuestion.map((p) => p.primary_label).filter(Boolean));
			proposalStatsByQuestion[questionId] = {
				ideaCount: forQuestion.length,
				clusterCount: clusterKeys.size
			};
		}

		let proposalVotes: { question: string; user: string }[] = [];
		try {
			const filter = allRelevantIds.map((id) => `question="${id}"`).join(' || ');
			proposalVotes = await locals.pb
				.collection('proposal_votes')
				.getFullList<{ question: string; user: string }>({ filter, fields: 'question,user' });
		} catch {
			proposalVotes = [];
		}

		for (const questionId of allRelevantIds) {
			const users = new Set(
				proposalVotes.filter((v) => v.question === questionId).map((v) => v.user)
			);
			activeUsersByQuestion[questionId] = users.size;
		}
	}

	const groupIds = [...new Set(allNormalized.map((q) => q.group).filter(Boolean))] as string[];
	const groupNamesById: Record<string, string> = {};
	if (groupIds.length > 0) {
		try {
			const filter = groupIds.map((id) => `id="${id}"`).join(' || ');
			const groups = await locals.pb
				.collection('groups')
				.getFullList<{ id: string; name: string }>({
					filter,
					fields: 'id,name'
				});
			for (const g of groups) {
				groupNamesById[g.id] = g.name;
			}
		} catch (err) {
			console.warn('[discourse] Failed to fetch group names', err);
		}
	}

	return {
		allQuestions,
		decidedQuestions,
		proposalStatsByQuestion,
		activeUsersByQuestion,
		groupNamesById,
		user: locals.user
	};
};
