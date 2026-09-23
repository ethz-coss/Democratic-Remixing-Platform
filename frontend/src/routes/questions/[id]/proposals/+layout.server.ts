import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { buildUserProposalVoteMap, normalizeProposalRecord } from '$lib/server/proposals';
import {
	buildQuestionScoreMap,
	deriveQuestionState,
	escapeFilter,
	normalizeQuestionRecord
} from '$lib/server/questions';
import { normalizeSingleRelation } from '$lib/server/normalize';

function normalizeTimelineEventType(
	rawType: unknown
): App.QuestionTimelineEventRecord['event_type'] {
	const type = String(rawType ?? 'PhaseTransition');
	const event_type: App.QuestionTimelineEventRecord['event_type'] =
		type === 'ThresholdPassedForSolving' ||
		type === 'ThresholdPassedForVoting' ||
		type === 'VotingPhaseFinished' ||
		type === 'SalvagePhase' ||
		type === 'LoopContinues' ||
		type === 'SingleProposalRemaining' ||
		type === 'RootProposalAdded' ||
		type === 'ProposalBranched' ||
		type === 'PhaseTransition' ||
		type === 'QuestionCreated' ||
		type === 'IdeaDeactivated'
			? type
			: 'PhaseTransition';

	return event_type;
}

function normalizeTimelinePhase(
	rawPhase: unknown
): App.QuestionTimelineEventRecord['phase'] | null {
	const phase = String(rawPhase ?? '').trim();
	// Canonical phases
	if (phase === 'Proposed' || phase === 'AnswerSearch' || phase === 'Voting') {
		return phase;
	}

	if (phase === 'Closing' || phase === 'Closing_Window' || phase === 'closing_window') {
		return 'Closing' as App.QuestionTimelineEventRecord['phase'];
	}

	// Legacy backward compat
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

function normalizeQuestionPhaseAsTimelineEvent(
	record: Record<string, unknown>,
	questionId: string
): App.QuestionTimelineEventRecord | null {
	const id = String(record.id ?? '').trim();
	const phase = normalizeTimelinePhase(record.phase_name);
	const occurred_at = String(record.started_at ?? '').trim();

	if (!id || !phase || !Number.isFinite(Date.parse(occurred_at))) {
		return null;
	}

	const metadata_json =
		typeof record.transition_metadata_json === 'string'
			? record.transition_metadata_json
			: JSON.stringify(record.transition_metadata_json ?? '');

	return {
		id,
		question: normalizeSingleRelation(record.question) || questionId,
		event_type: normalizeTimelineEventType(record.transition_type),
		phase,
		occurred_at,
		round: '',
		remaining_proposals: null,
		source_record_id: String(record.source_record_id ?? ''),
		metadata_json,
		created: String(occurred_at || record.created || ''),
		updated: String(record.updated ?? record.created ?? occurred_at)
	};
}

export const load: LayoutServerLoad = async ({ locals, params, url, depends, fetch }) => {
	// Register granular dependency — only `invalidate('app:proposals')` will re-run this loader
	depends('app:proposals');

	const questionId = params.id;
	const authoringPhaseRaw = String(url.searchParams.get('authoring_phase') ?? '').trim();
	const authoringBlockedPhase =
		authoringPhaseRaw === 'Proposed' ||
		authoringPhaseRaw === 'Closing' ||
		authoringPhaseRaw === 'Voting'
			? authoringPhaseRaw
			: null;

	let initialRawQuestion;
	try {
		initialRawQuestion = await locals.pb.collection('questions').getOne(questionId, {
			expand: 'current_phase',
			requestKey: `layout-question-${questionId}`,
			fetch
		});
	} catch (err: any) {
		if (err?.status === 404) {
			throw error(404, 'Question not found');
		}
		throw err;
	}
	let questionVotes: App.QuestionVoteRecord[] = [];
	try {
		questionVotes = await locals.pb
			.collection('question_votes')
			.getFullList<App.QuestionVoteRecord>({
				filter: `question = "${escapeFilter(questionId)}"`,
				requestKey: `layout-question-votes-${questionId}`,
				fetch
			});
	} catch {
		questionVotes = [];
	}

	const scoreByQuestion = buildQuestionScoreMap(questionVotes);
	const question = deriveQuestionState(
		normalizeQuestionRecord(initialRawQuestion),
		scoreByQuestion[questionId] ?? 0
	);

	let rawProposals: Record<string, unknown>[] = [];
	try {
		rawProposals = await locals.pb.collection('proposals').getFullList({
			filter: `question="${escapeFilter(question.id)}"`,
			sort: '-id',
			expand: 'author',
			requestKey: `layout-proposals-${questionId}`,
			fetch
		});
	} catch {
		rawProposals = [];
	}

	const proposals = rawProposals.map((item) => normalizeProposalRecord(item));

	let proposalVotes: App.ProposalVoteRecord[] = [];
	if (proposals.length > 0) {
		try {
			proposalVotes = await locals.pb
				.collection('proposal_votes')
				.getFullList<App.ProposalVoteRecord>({
					filter: `question = "${escapeFilter(questionId)}"`,
					requestKey: `layout-proposal-votes-${questionId}`,
					fetch
				});
		} catch {
			proposalVotes = [];
		}
	}

	let labels: App.LabelRecord[] = [];
	try {
		labels = (await locals.pb.collection('labels').getFullList({
			filter: `question="${escapeFilter(question.id)}"`,
			sort: 'created',
			requestKey: `layout-labels-${questionId}`,
			fetch
		})) as App.LabelRecord[];
	} catch (err) {
		console.warn('[layout.server.ts] failed to fetch labels:', err);
		labels = [];
	}

	let userHiddenProposalIds: string[] = [];
	if (locals.user) {
		const hidesFilter = `user="${escapeFilter(locals.user.id)}"`;
		try {
			const hides = await locals.pb.collection('proposal_hides').getFullList({
				filter: hidesFilter,
				// requestKey: null disables SDK auto-cancellation so rapid navigation
				// never silently drops this fetch.
				requestKey: null,
				fetch
			});
			userHiddenProposalIds = hides.map((d: any) => d.proposal);
		} catch (err) {
			console.error('Failed to load hides:', err);
		}
	}

	// ── Compute focus reasons for frontend rendering ──────────
	const focusReasons: Record<string, 'score' | 'velocity'> = {};
	{
		const inFocusSols = proposals
			.filter((s) => s.in_focus && s.state === 'Proposed')
			.map((s) => ({ id: s.id, score: s.subscription_count ?? 0, created: s.created ?? '' }))
			.sort((a, b) => b.score - a.score);

		for (let i = 0; i < inFocusSols.length; i++) {
			focusReasons[inFocusSols[i].id] = 'score';
		}
	}

	const userProposalVotes = locals.user
		? buildUserProposalVoteMap(proposalVotes, locals.user.id)
		: {};

	const seenProposalIds = new Set<string>();
	if (locals.user) {
		try {
			const viewRecords = await locals.pb.collection('user_proposal_views').getFullList({
				filter: `user = "${locals.user.id}" && question = "${question.id}"`,
				fields: 'proposal',
				sort: '-last_viewed',
				requestKey: `layout-user-views-${questionId}`,
				fetch
			});
			for (const v of viewRecords) {
				seenProposalIds.add(v.proposal);
			}
		} catch (e) {
			// ignore, maybe collection doesn't exist yet
		}

		// Also mark voted + authored as seen
		for (const [pid, vote] of Object.entries(userProposalVotes)) {
			if (vote > 0) seenProposalIds.add(pid);
		}
		for (const p of proposals) {
			if (p.author === locals.user.id) seenProposalIds.add(p.id);
		}
	}

	// Build vote timestamps: proposalId → when the user last voted
	const userVoteTimestamps: Record<string, string> = {};
	if (locals.user) {
		for (const v of proposalVotes) {
			if (v.user === locals.user.id && v.vote !== 0) {
				userVoteTimestamps[v.proposal] = String((v as any).occurred_at || v.updated || v.created);
			}
		}
	}

	// Compute unseen improvements (remixes) on the backend using seenProposalIds
	const unseenImprovements: Record<string, number> = {};
	if (locals.user) {
		for (const p of proposals) {
			let count = 0;
			for (const child of proposals) {
				if (child.parent_proposals?.includes(p.id) && !seenProposalIds.has(child.id)) {
					count++;
				}
			}
			if (count > 0) {
				unseenImprovements[p.id] = count;
			}
		}
	}

	let rawQuestionPhases: Record<string, unknown>[] = [];
	try {
		rawQuestionPhases = (await locals.pb.collection('question_phases').getFullList({
			filter: `question = "${escapeFilter(question.id)}"`,
			sort: '+started_at,+id',
			requestKey: `layout-question-phases-${questionId}`,
			fetch
		})) as Record<string, unknown>[];
	} catch {
		rawQuestionPhases = [];
	}

	const timelineEvents: App.QuestionTimelineEventRecord[] = rawQuestionPhases
		.map((phase) => normalizeQuestionPhaseAsTimelineEvent(phase, question.id))
		.filter((event): event is App.QuestionTimelineEventRecord => event !== null);
	timelineEvents.sort((a, b) => {
		const timeDiff = Date.parse(a.occurred_at) - Date.parse(b.occurred_at);
		if (Number.isFinite(timeDiff) && timeDiff !== 0) {
			return timeDiff;
		}
		return a.id.localeCompare(b.id);
	});

	// Active voters (unique users who have voted)
	const activeUsersCount = new Set(proposalVotes.map((v) => v.user)).size;

	let hasVoted = false;
	if (locals.user) {
		try {
			const existing = await locals.pb.send('/api/custom/ballot-responses/existing', {
				query: {
					user: locals.user.id,
					question: questionId
				},
				fetch
			});
			if (existing && existing.id) {
				hasVoted = true;
			}
		} catch (e) {
			// Not found
		}
	}

	return {
		question,
		proposals,
		userProposalVotes,
		proposalVoteRecords: proposalVotes,

		labels,
		userHiddenProposalIds,

		timelineEvents,
		rawQuestionPhases: rawQuestionPhases as Array<Record<string, unknown>>,
		authoringBlockedPhase,
		user: locals.user,
		totalUsers: activeUsersCount,
		focusReasons,
		userVoteTimestamps,
		unseenImprovements,
		seenProposalIds: Array.from(seenProposalIds),
		hasVoted
	};
};
