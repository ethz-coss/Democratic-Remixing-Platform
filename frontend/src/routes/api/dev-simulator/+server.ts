import { dev } from '$app/environment';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { escapeFilter } from '$lib/server/questions';
import {
	createSimulationUsers,
	listSimulationUsers,
	simulateBranchProposals,
	simulateProposeMerges,
	simulateMergeProposals,
	simulateVotesToProgress,
	simulateQuestionActivationVotes,
	simulateFinalVotes,
	simulateAbstentions,
	type SimActionResult
} from '$lib/server/simulator/question-simulator';
import { createServerPocketBase } from '$lib/server/pb.server';
import {
	PRIVATE_PB_SUPERUSER_EMAIL,
	PRIVATE_PB_SUPERUSER_PASSWORD,
	PRIVATE_SIM_USER_PASSWORD
} from '$lib/server/env';

interface QuestionDebugSummary {
	id: string;
	title: string;
	status: string;
	proposedProposals: number;
	archivedProposals: number;
}

interface SimulationRunSummary {
	id: string;
	label: string;
	status: string;
	questionId: string;
	startedAt: string;
	lastActionAt: string;
	userCount: number;
	actionCount: number;
}

interface RunUserSummary {
	runUserId: string;
	id: string;
	username: string;
	email: string;
	name: string;
	simulation: boolean;
}

interface DeletionSummary {
	deletedByCollection: Record<string, number>;
	warnings: string[];
}

type QuestionPhaseKey =
	| 'Proposed'
	| 'Ideation'
	| 'Mapping'
	| 'Exploration'
	| 'Voting'
	| 'AnswerSearch';

function isIdeationLikePhase(phase: QuestionPhaseKey | null): boolean {
	return phase === 'AnswerSearch';
}

const VALID_PHASES = new Set<QuestionPhaseKey>([
	'Proposed',
	'Ideation',
	'Mapping',
	'Exploration',
	'Voting',
	'AnswerSearch'
]);

function normalizePhaseKey(raw: string): QuestionPhaseKey | null {
	const cleaned = raw.trim() as QuestionPhaseKey;
	if (!cleaned) {
		return null;
	}
	return VALID_PHASES.has(cleaned) ? cleaned : null;
}

function resolveEffectiveSummaryPhase(
	summary: QuestionDebugSummary | null
): QuestionPhaseKey | null {
	if (!summary) {
		return null;
	}

	const normalized = normalizePhaseKey(String(summary.status ?? ''));

	if (normalized === 'AnswerSearch') {
		return 'AnswerSearch';
	}

	if (normalized) {
		return normalized;
	}

	return null;
}

function resolveQuestionPhaseStatus(record: Record<string, unknown>): string {
	const expanded =
		record.expand && typeof record.expand === 'object'
			? (record.expand as Record<string, unknown>).current_phase
			: null;
	const expandedPhase =
		expanded && typeof expanded === 'object'
			? String((expanded as Record<string, unknown>).phase_name ?? '').trim()
			: '';
	const rawPhase =
		expandedPhase ||
		String(record.current_phase_name ?? '').trim() ||
		String(record.status ?? '').trim() ||
		'';

	const normalized = normalizePhaseKey(rawPhase);
	return normalized ?? 'Proposed';
}

function isMissingSimulationCollectionsError(err: unknown): boolean {
	const text = err instanceof Error ? err.message : String(err ?? '');
	const normalized = text.toLowerCase();
	if (!normalized.includes('collection')) {
		return false;
	}
	return (
		normalized.includes('simulation_runs') ||
		normalized.includes('simulation_actions') ||
		normalized.includes('simulation')
	);
}

function ensureDebugAccess(locals: App.Locals) {
	if (!dev || !locals.user) {
		return false;
	}
	return true;
}

async function loadQuestionSummary(
	pb: App.Locals['pb'],
	questionId: string
): Promise<QuestionDebugSummary | null> {
	try {
		const record = await pb.collection('questions').getOne<Record<string, unknown>>(questionId, {
			expand: 'current_phase'
		});

		const safeCount = async (load: () => Promise<{ totalItems: number }>): Promise<number> => {
			try {
				const page = await load();
				return Number(page.totalItems ?? 0);
			} catch {
				return 0;
			}
		};

		const [proposedProposals, archivedProposals] = await Promise.all([
			safeCount(() =>
				pb.collection('proposals').getList<Record<string, unknown>>(1, 1, {
					filter: `question = "${escapeFilter(questionId)}" && (state = "Proposed" || state = "Active")`
				})
			),
			safeCount(() =>
				pb.collection('proposals').getList<Record<string, unknown>>(1, 1, {
					filter: `question = "${escapeFilter(questionId)}" && state = "Archived"`
				})
			)
		]);

		return {
			id: String(record.id ?? ''),
			title: String(record.title ?? ''),
			status: resolveQuestionPhaseStatus(record),
			proposedProposals,
			archivedProposals
		};
	} catch {
		return null;
	}
}

async function loadPhaseRefreshPayload(pb: App.Locals['pb'], questionId: string) {
	const selectedQuestionSummary = await loadQuestionSummary(pb, questionId);
	const activePhaseKey = resolveEffectiveSummaryPhase(selectedQuestionSummary);
	return {
		selectedQuestionSummary,
		activePhaseKey
	};
}

async function getQuestions(pb: App.Locals['pb']) {
	try {
		const items = await pb.collection('questions').getFullList<Record<string, unknown>>({
			expand: 'current_phase'
		});
		return sortRunItemsNewestFirst(items);
	} catch {
		try {
			const page = await pb.collection('questions').getList<Record<string, unknown>>(1, 200, {
				expand: 'current_phase'
			});
			return sortRunItemsNewestFirst(page.items);
		} catch {
			return [];
		}
	}
}

function parseRunRecord(record: Record<string, unknown>): SimulationRunSummary {
	return {
		id: String(record.id ?? ''),
		label: String(record.label ?? ''),
		status: String(record.status ?? 'active'),
		questionId: String(record.question ?? ''),
		startedAt: String(record.started_at ?? ''),
		lastActionAt: String(record.last_action_at ?? ''),
		userCount: 0,
		actionCount: 0
	};
}

function relationId(value: unknown): string {
	if (Array.isArray(value)) {
		const first = value[0];
		if (first && typeof first === 'object') {
			const id = (first as { id?: unknown }).id;
			return String(id ?? '').trim();
		}
		return String(first ?? '').trim();
	}
	if (value && typeof value === 'object') {
		const id = (value as { id?: unknown }).id;
		return String(id ?? '').trim();
	}
	return String(value ?? '').trim();
}

function asTimestamp(value: unknown): number {
	const parsed = Date.parse(String(value ?? ''));
	return Number.isFinite(parsed) ? parsed : 0;
}

function sortRunItemsNewestFirst(items: Record<string, unknown>[]): Record<string, unknown>[] {
	return [...items].sort((a, b) => {
		const byUpdated = asTimestamp(b.updated) - asTimestamp(a.updated);
		if (byUpdated !== 0) {
			return byUpdated;
		}
		return asTimestamp(b.created) - asTimestamp(a.created);
	});
}

function parseCount(raw: string, fallback: number, max: number): number {
	const parsed = Math.round(Number(raw || String(fallback)));
	if (!Number.isFinite(parsed)) {
		return fallback;
	}
	return Math.max(1, Math.min(max, parsed));
}

function parseSpreadDays(raw: string): number {
	const parsed = Number(raw);
	if (!Number.isFinite(parsed)) {
		return 0;
	}
	return Math.max(0, Math.min(365, Math.round(parsed)));
}

function resolveScheduledStart(startDateRaw: string): string | null {
	const startMs = Date.parse(startDateRaw);
	if (!Number.isFinite(startMs)) {
		return null;
	}
	return new Date(startMs).toISOString();
}

function sampleWithoutReplacement<T>(items: T[], count: number): T[] {
	if (count >= items.length) {
		return [...items];
	}
	const pool = [...items];
	for (let i = pool.length - 1; i > 0; i -= 1) {
		const j = Math.floor(Math.random() * (i + 1));
		const current = pool[i];
		pool[i] = pool[j] as T;
		pool[j] = current as T;
	}
	return pool.slice(0, Math.max(0, count));
}

async function authAsSimulationIdentity(identity: string) {
	const pb = createServerPocketBase();
	await pb.collection('users').authWithPassword(identity, PRIVATE_SIM_USER_PASSWORD);
	return pb;
}

function nowIso() {
	return new Date().toISOString();
}

function pocketbaseErrorDetails(error: unknown): string {
	if (!error) return 'unknown error';
	const err = error as {
		message?: unknown;
		response?: { status?: unknown; data?: unknown; message?: unknown };
	};
	const message = typeof err?.message === 'string' && err.message ? err.message : 'unknown error';
	const responseMessage =
		typeof err?.response?.message === 'string' && err.response.message
			? ` responseMessage=${err.response.message}`
			: '';
	let responseData = '';
	try {
		if (err?.response?.data !== undefined) {
			responseData = ` responseData=${JSON.stringify(err.response.data)}`;
		}
	} catch {
		responseData = ' responseData=[unserializable]';
	}
	const status =
		err?.response?.status !== undefined ? ` status=${String(err.response.status)}` : '';
	return `${message}${status}${responseMessage}${responseData}`;
}

function isMissingRelationRecordError(error: unknown, fieldName: string): boolean {
	const err = error as {
		response?: { data?: Record<string, { code?: unknown; message?: unknown }> };
		message?: unknown;
	};
	const field = err?.response?.data?.[fieldName];
	if (String(field?.code ?? '') === 'validation_missing_rel_records') {
		return true;
	}
	const message =
		typeof field?.message === 'string'
			? field.message
			: typeof err?.message === 'string'
				? err.message
				: '';
	return message.toLowerCase().includes('relation records');
}

function isUniqueReadinessError(error: unknown): boolean {
	const err = error as {
		response?: { data?: Record<string, { code?: unknown; message?: unknown }> };
		message?: unknown;
	};
	const questionCode = String(err?.response?.data?.question?.code ?? '').trim();
	const userCode = String(err?.response?.data?.user?.code ?? '').trim();
	if (questionCode === 'validation_not_unique' || userCode === 'validation_not_unique') {
		return true;
	}
	const message = typeof err?.message === 'string' ? err.message : '';
	return (
		message.toLowerCase().includes('not_unique') || message.toLowerCase().includes('must be unique')
	);
}

function fitJsonForLog(value: unknown, maxChars = 120000) {
	try {
		const serialized = JSON.stringify(value);
		if (!serialized || serialized.length <= maxChars) {
			return value;
		}
		return {
			truncated: true,
			originalSize: serialized.length,
			preview: serialized.slice(0, maxChars)
		};
	} catch {
		return {
			truncated: true,
			reason: 'non-serializable payload'
		};
	}
}

function isSimulationUser(record: Record<string, unknown>): boolean {
	const raw = record.simulation;
	if (raw === true || raw === 'true' || raw === 1 || raw === '1') {
		return true;
	}
	const username = String(record.username ?? '')
		.trim()
		.toLowerCase();
	const email = String(record.email ?? '')
		.trim()
		.toLowerCase();
	return username.startsWith('sim_') || email.endsWith('@sim.local');
}

async function listRunUsers(pb: App.Locals['pb'], runId: string): Promise<RunUserSummary[]> {
	void runId;
	const users = await listSimulationUsers(pb);
	return users.map((user) => ({
		runUserId: user.id,
		id: user.id,
		username: String(user.username ?? '').trim(),
		email: String(user.email ?? '').trim(),
		name: String(user.name ?? '').trim(),
		simulation: true
	}));
}

async function getOwnedRun(pb: App.Locals['pb'], runId: string, userId: string) {
	const run = await pb.collection('simulation_runs').getOne<Record<string, unknown>>(runId);
	// Dev simulator should remain operable even when runs were created under another dev user.
	// Keep this permissive in dev mode so existing runs remain selectable/debuggable.
	void userId;
	return run;
}

async function findRunForQuestion(
	pb: App.Locals['pb'],
	questionId: string
): Promise<SimulationRunSummary | null> {
	if (!questionId) {
		return null;
	}

	let record: Record<string, unknown> | null = null;
	try {
		record = await pb
			.collection('simulation_runs')
			.getFirstListItem<Record<string, unknown>>(`question = "${escapeFilter(questionId)}"`);
	} catch {
		record = null;
	}

	if (!record) {
		return null;
	}

	const run = parseRunRecord(record);
	try {
		const [simUsers, actionsPage] = await Promise.all([
			listSimulationUsers(pb),
			pb.collection('simulation_actions').getList<Record<string, unknown>>(1, 1, {
				filter: `run = "${escapeFilter(run.id)}"`
			})
		]);
		run.userCount = simUsers.length;
		run.actionCount = actionsPage.totalItems;
	} catch {
		run.userCount = 0;
		run.actionCount = 0;
	}
	return run;
}

async function logSimulationAction(args: {
	pb: App.Locals['pb'];
	runId: string;
	questionId: string;
	actorId: string;
	actionType: string;
	ok: boolean;
	details: string;
	input: Record<string, unknown>;
	result: unknown;
}) {
	const actionTypeMap: Record<string, string> = {
		createSimUsers: 'createSimUsers',
		startSimulation: 'startSimulation',
		deleteSimUser: 'deleteSimulation',
		deleteSimulation: 'deleteSimulation',
		initialProposals: 'branchProposals',
		remixProposals: 'mergeProposals',
		voteProgress: 'voteProgress',
		proceedSelection: 'voteProgress',
		createFinalBallot: 'voteProgress',
		selectionRankBallots: 'voteProgress',
		selectionAbstainBallots: 'voteProgress',
		runIdeationBatch: 'playback'
	};
	const normalizedActionType = actionTypeMap[args.actionType] ?? 'playback';
	let actorForLog: string | null = null;
	if (args.actorId) {
		try {
			await args.pb.collection('users').getOne<Record<string, unknown>>(args.actorId);
			actorForLog = args.actorId;
		} catch {
			console.warn(
				`[dev-simulator] actor ${args.actorId} is not a users record; logging simulation_action without actor relation`
			);
		}
	}
	const timestamp = nowIso();
	try {
		const payload: Record<string, unknown> = {
			run: args.runId,
			question: args.questionId,
			action_type: normalizedActionType,
			// PocketBase required bool fields reject false as blank in this schema.
			// Keep a guaranteed true log flag and preserve actual action outcome in result_json.
			ok: true,
			details: String(args.details || '').slice(0, 1800),
			input_json: fitJsonForLog(args.input),
			result_json: fitJsonForLog(args.result),
			occurred_at: timestamp
		};
		console.info(
			`[dev-simulator] simulation_actions payload action_type=${normalizedActionType} run=${args.runId} ok=${String(payload.ok)}`
		);
		if (actorForLog) {
			payload.actor = actorForLog;
		}
		await args.pb.collection('simulation_actions').create(payload);
	} catch (error) {
		const message = pocketbaseErrorDetails(error);
		console.error(
			`[dev-simulator] simulation_actions create failed action_type=${normalizedActionType} run=${args.runId}: ${message}`
		);
		// Logging must never block the simulator action itself.
	}

	try {
		await args.pb.collection('simulation_runs').update(args.runId, {
			last_action_at: timestamp
		});
	} catch {
		// Ignore run timestamp update failures.
	}
}

async function collectRunRefs(pb: App.Locals['pb'], runId: string) {
	const actions = await pb.collection('simulation_actions').getFullList<Record<string, unknown>>({
		filter: `run = "${escapeFilter(runId)}"`,
		sort: '-occurred_at'
	});

	const refsByCollection = new Map<string, Set<string>>();
	for (const action of actions) {
		const raw = action.result_json as
			| { refs?: Array<{ collection?: string; id?: string }> }
			| undefined;
		const refs = Array.isArray(raw?.refs) ? raw.refs : [];
		for (const ref of refs) {
			const collection = String(ref.collection ?? '').trim();
			const id = String(ref.id ?? '').trim();
			if (!collection || !id) {
				continue;
			}
			if (!refsByCollection.has(collection)) {
				refsByCollection.set(collection, new Set());
			}
			refsByCollection.get(collection)?.add(id);
		}
	}

	return refsByCollection;
}

function appendWarning(summary: DeletionSummary, warning: string) {
	if (!warning) {
		return;
	}
	summary.warnings.push(warning);
}

function incrementDeleteCount(summary: DeletionSummary, collection: string, delta = 1) {
	summary.deletedByCollection[collection] = (summary.deletedByCollection[collection] ?? 0) + delta;
}

async function createPrivilegedPocketBase() {
	if (!PRIVATE_PB_SUPERUSER_EMAIL || !PRIVATE_PB_SUPERUSER_PASSWORD) {
		throw new Error(
			'Missing PB superuser credentials. Set PRIVATE_PB_SUPERUSER_EMAIL and PRIVATE_PB_SUPERUSER_PASSWORD.'
		);
	}

	const pb = createServerPocketBase();
	try {
		await pb
			.collection('_superusers')
			.authWithPassword(PRIVATE_PB_SUPERUSER_EMAIL, PRIVATE_PB_SUPERUSER_PASSWORD);
		return pb;
	} catch {
		await pb
			.collection('_admins')
			.authWithPassword(PRIVATE_PB_SUPERUSER_EMAIL, PRIVATE_PB_SUPERUSER_PASSWORD);
		return pb;
	}
}

async function deleteRecordsByIds(args: {
	pb: App.Locals['pb'];
	collection: string;
	ids: string[];
	summary: DeletionSummary;
}) {
	const uniqueIds = Array.from(
		new Set(args.ids.map((id) => String(id ?? '').trim()).filter(Boolean))
	);
	for (const id of uniqueIds) {
		try {
			await args.pb.collection(args.collection).delete(id);
			incrementDeleteCount(args.summary, args.collection);
		} catch (error) {
			const text = error instanceof Error ? error.message : String(error ?? 'unknown error');
			appendWarning(args.summary, `Failed deleting ${args.collection}/${id}: ${text}`);
		}
	}
}

async function deleteCollectionByFilter(args: {
	pb: App.Locals['pb'];
	collection: string;
	filter?: string;
	summary: DeletionSummary;
}) {
	let items: Record<string, unknown>[] = [];
	try {
		items = await args.pb.collection(args.collection).getFullList<Record<string, unknown>>({
			filter: args.filter || undefined
		});
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error ?? 'unknown error');
		appendWarning(args.summary, `Failed listing ${args.collection}: ${text}`);
		return;
	}

	await deleteRecordsByIds({
		pb: args.pb,
		collection: args.collection,
		ids: items.map((item) => String(item.id ?? '')),
		summary: args.summary
	});
}

async function createFreshIdeationQuestion(pb: App.Locals['pb'], authorId: string) {
	const now = new Date();
	const created = await pb.collection('questions').create({
		author: authorId,
		title: `Fresh ideation question ${now.toISOString().slice(0, 19).replace('T', ' ')}`,
		description: 'Fresh ideation seed.',
		constraints: '[]',
		current_phase_name: 'Ideation'
	});
	return String(created.id ?? '').trim();
}

async function pruneQuestionTimelineForRun(args: {
	pb: App.Locals['pb'];
	questionId: string;
	runId: string;
	runStartedAt: string;
	sourceRecordIds: Set<string>;
	summary: DeletionSummary;
}) {
	if (!args.questionId) {
		return;
	}

	let phases: Record<string, unknown>[] = [];
	try {
		phases = await args.pb.collection('question_phases').getFullList<Record<string, unknown>>({
			filter: `question = "${escapeFilter(args.questionId)}"`,
			sort: '+started_at,+id'
		});
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error ?? 'unknown error');
		appendWarning(args.summary, `Failed loading question phases for run prune: ${text}`);
		return;
	}

	if (phases.length === 0) {
		return;
	}

	const runStartMs = Date.parse(args.runStartedAt);
	const hasRunStart = Number.isFinite(runStartMs);

	const kept = phases.filter((phase) => {
		const sourceRecordId = String(phase.source_record_id ?? '').trim();
		if (sourceRecordId && args.sourceRecordIds.has(sourceRecordId)) {
			return false;
		}

		if (!hasRunStart) {
			return true;
		}

		const occurredAtMs = Date.parse(String(phase.started_at ?? ''));
		if (!Number.isFinite(occurredAtMs) || occurredAtMs < runStartMs) {
			return true;
		}

		const eventType = String(phase.transition_type ?? '').trim();
		if (eventType === 'QuestionCreated') {
			return true;
		}

		if (sourceRecordId === args.questionId || sourceRecordId === '') {
			return false;
		}

		return true;
	});

	const prunedCount = phases.length - kept.length;
	if (prunedCount <= 0) {
		return;
	}

	try {
		const keptIds = new Set(kept.map((item) => String(item.id ?? '')));
		for (const phase of phases) {
			const phaseId = String(phase.id ?? '');
			if (!phaseId || keptIds.has(phaseId)) {
				continue;
			}
			await args.pb.collection('question_phases').delete(phaseId);
			incrementDeleteCount(args.summary, 'question_phases');
		}
		const nextCurrentPhase = kept.length > 0 ? String(kept[kept.length - 1].id ?? '') : '';
		const nextCurrentPhaseName =
			kept.length > 0 ? String(kept[kept.length - 1].phase_name ?? 'Proposed') : 'Proposed';
		await args.pb.collection('questions').update(args.questionId, {
			current_phase: nextCurrentPhase || null,
			current_phase_name: nextCurrentPhaseName
		});
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error ?? 'unknown error');
		appendWarning(args.summary, `Failed pruning question phases during run cleanup: ${text}`);
	}
}

async function resetSimulationEnvironment(pb: App.Locals['pb'], authorId: string) {
	const summary: DeletionSummary = {
		deletedByCollection: {},
		warnings: []
	};

	const deleteOrder = [
		'simulation_actions',
		'simulation_runs',
		'proposal_votes',
		'question_votes',

		'proposals',
		'group_members',
		'question_members',
		'groups',
		'questions'
	];

	for (const collection of deleteOrder) {
		await deleteCollectionByFilter({ pb, collection, summary });
	}

	await deleteCollectionByFilter({
		pb,
		collection: 'users',
		filter: 'simulation = true',
		summary
	});

	const questionId = await createFreshIdeationQuestion(pb, authorId);

	return {
		questionId,
		summary
	};
}

async function deleteRunArtifacts(
	pb: App.Locals['pb'],
	args: {
		runId: string;
		questionId: string;
		runStartedAt: string;
	}
) {
	const runId = args.runId;
	const refsByCollection = await collectRunRefs(pb, runId);
	const summary: DeletionSummary = {
		deletedByCollection: {},
		warnings: []
	};

	const deleteOrder = ['question_votes', 'proposal_votes', 'proposals', 'users'];

	const deletedCollections = new Set<string>();
	for (const collection of deleteOrder) {
		const ids = Array.from(refsByCollection.get(collection) ?? []);
		deletedCollections.add(collection);
		await deleteRecordsByIds({ pb, collection, ids, summary });
	}

	for (const [collection, idsSet] of refsByCollection.entries()) {
		if (deletedCollections.has(collection)) {
			continue;
		}
		await deleteRecordsByIds({
			pb,
			collection,
			ids: Array.from(idsSet),
			summary
		});
	}

	const sourceRecordIds = new Set<string>();
	for (const idsSet of refsByCollection.values()) {
		for (const id of idsSet.values()) {
			sourceRecordIds.add(String(id ?? '').trim());
		}
	}
	await pruneQuestionTimelineForRun({
		pb,
		questionId: args.questionId,
		runId,
		runStartedAt: args.runStartedAt,
		sourceRecordIds,
		summary
	});

	const runActions = await pb
		.collection('simulation_actions')
		.getFullList<Record<string, unknown>>({
			filter: `run = "${escapeFilter(runId)}"`
		});
	for (const action of runActions) {
		try {
			await pb.collection('simulation_actions').delete(String(action.id ?? ''));
			incrementDeleteCount(summary, 'simulation_actions');
		} catch {
			appendWarning(
				summary,
				`Failed deleting simulation_actions/${String(action.id ?? '')} during run cleanup.`
			);
		}
	}

	await deleteRecordsByIds({
		pb,
		collection: 'simulation_runs',
		ids: [runId],
		summary
	});

	return {
		summary,
		actionCount: runActions.length,
		runUserCount: 0
	};
}

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!ensureDebugAccess(locals)) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}
	(locals.pb as { autoCancellation?: (enabled: boolean) => void }).autoCancellation?.(false);

	const userId = String(locals.user?.id ?? '');
	if (!userId) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}

	const questionsRaw = await getQuestions(locals.pb);
	const questions = questionsRaw.map((question) => ({
		id: String(question.id ?? ''),
		title: String(question.title ?? ''),
		current_phase_name: resolveQuestionPhaseStatus(question),
		updated: String(question.updated ?? '')
	}));

	const requestedQuestionId = String(url.searchParams.get('question') ?? '').trim();
	const selectedQuestionId = requestedQuestionId || questions[0]?.id || '';
	const selectedQuestionSummary = selectedQuestionId
		? await loadQuestionSummary(locals.pb, selectedQuestionId)
		: null;
	const activePhaseKey = resolveEffectiveSummaryPhase(selectedQuestionSummary);

	let run: SimulationRunSummary | null = null;
	let selectedRunId = '';
	let selectedRunUserCount = 0;
	let selectedRunUsers: RunUserSummary[] = [];
	let simulationCollectionsReady = true;
	let simulationCollectionsMessage = '';
	try {
		run = await findRunForQuestion(locals.pb, selectedQuestionId);
		selectedRunId = run?.id ?? '';
		selectedRunUserCount = run?.userCount ?? 0;
	} catch (err) {
		run = null;
		selectedRunId = '';
		selectedRunUserCount = 0;
		simulationCollectionsReady = false;
		simulationCollectionsMessage = isMissingSimulationCollectionsError(err)
			? 'Simulation storage is not ready yet. Run dev:restart to apply migrations, then reload.'
			: 'Simulation run data could not be loaded. If this persists, run dev:restart and reload this page.';
	}

	let simUsers: Array<{ id: string; email: string; username: string }> = [];
	try {
		const rawSimUsers = await listSimulationUsers(locals.pb);
		simUsers = rawSimUsers.map((u) => ({
			id: u.id,
			email: String(u.email ?? ''),
			username: String(u.username ?? '')
		}));

		selectedRunUsers = rawSimUsers.map((user) => ({
			runUserId: user.id,
			id: user.id,
			username: String(user.username ?? '').trim(),
			email: String(user.email ?? '').trim(),
			name: String(user.name ?? '').trim(),
			simulation: true
		}));
		selectedRunUserCount = selectedRunUsers.length;
	} catch {
		selectedRunUsers = [];
		simUsers = [];
	}

	return json({
		questions,
		selectedQuestionId,
		selectedQuestionSummary,
		activePhaseKey,
		run,
		selectedRunId,
		selectedRunUserCount,
		selectedRunUsers,
		simulationCollectionsReady,
		simulationCollectionsMessage,
		simUsers
	});
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!ensureDebugAccess(locals)) {
		return json({ ok: false, message: 'Unauthorized' }, { status: 401 });
	}
	(locals.pb as { autoCancellation?: (enabled: boolean) => void }).autoCancellation?.(false);

	let body: Record<string, unknown> = {};
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return json({ ok: false, message: 'Invalid JSON body.' }, { status: 400 });
	}

	const action = String(body.action ?? '').trim();
	const questionId = String(body.questionId ?? '').trim();
	const questionTitle = String(body.questionTitle ?? '').trim() || 'Untitled question';
	const runId = String(body.runId ?? '').trim();
	const count = String(body.count ?? '').trim();
	const label = String(body.label ?? '').trim();
	const userRecordId = String(body.userId ?? '').trim();
	const startDateRaw = String(body.startDate ?? '').trim();
	const spreadDaysRaw = String(body.spreadDays ?? '').trim();
	const remixMode = String(body.remixMode ?? 'merge')
		.trim()
		.toLowerCase();
	const batchActions = Array.isArray(body.batchActions)
		? body.batchActions.map((item) => String(item ?? '').trim()).filter(Boolean)
		: [];
	const initialCountRaw = String(body.initialCount ?? '').trim();
	const remixCountRaw = String(body.remixCount ?? '').trim();

	const votesCountRaw = String(body.votesCount ?? '').trim();
	const mergesCountRaw = String(body.mergesCount ?? body.contradictionsCount ?? '').trim();
	const proceedCountRaw = String(body.proceedCount ?? '').trim();
	const selectionRankCountRaw = String(body.selectionRankCount ?? '').trim();
	const selectionAbstainCountRaw = String(body.selectionAbstainCount ?? '').trim();
	const durationMinutesRaw = String(body.durationMinutes ?? '').trim();
	const userId = String(locals.user?.id ?? '');

	if (!userId) {
		return json({ ok: false, message: 'Unauthorized' }, { status: 401 });
	}

	try {
		// startSimulation is no longer a separate action — runs are auto-created
		// by the auto-ensure block below when any action is performed.

		// selectSimulation and deleteSimulation removed — one run per question model.
		// Use resetAllSimulationData for full cleanup.

		if (action === 'resetAllSimulationData') {
			const confirmText = String(body.confirmText ?? '').trim();
			if (confirmText !== 'DELETE_ALL_SIMULATION_DATA') {
				return json(
					{ ok: false, message: 'Confirmation missing. Provide DELETE_ALL_SIMULATION_DATA.' },
					{ status: 400 }
				);
			}

			const privilegedPb = await createPrivilegedPocketBase();
			const reset = await resetSimulationEnvironment(privilegedPb as App.Locals['pb'], userId);
			return json({
				ok: true,
				questionId: reset.questionId,
				runId: '',
				message: `Global cleanup complete. Created fresh Ideation question ${reset.questionId}.`,
				deletionSummary: reset.summary
			});
		}

		if (!questionId) {
			return json({ ok: false, message: 'Choose a question first.' }, { status: 400 });
		}

		// Auto-ensure a run exists for this question (one-run-per-question model).
		let effectiveRunId = runId;
		if (!effectiveRunId) {
			const existingRun = await findRunForQuestion(locals.pb, questionId);
			if (existingRun) {
				effectiveRunId = existingRun.id;
			} else {
				const created = await locals.pb.collection('simulation_runs').create({
					owner: userId,
					question: questionId,
					label: `Simulation ${new Date().toLocaleString()}`,
					status: 'active',
					started_at: nowIso(),
					last_action_at: nowIso(),
					meta_json: { startedFromQuestionTitle: questionTitle }
				});
				effectiveRunId = String(created.id ?? '');
			}
		}

		if (action === 'createSimUsers') {
			const parsedCount = parseCount(count, 3, 20);
			const result = await createSimulationUsers(locals.pb, parsedCount, effectiveRunId);

			await logSimulationAction({
				pb: locals.pb,
				runId: effectiveRunId,
				questionId,
				actorId: userId,
				actionType: 'createSimUsers',
				ok: result.ok,
				details: result.details,
				input: { count: parsedCount },
				result
			});
			if (!result.ok) {
				return json({ ok: false, message: result.details, result }, { status: 400 });
			}

			return json({ ok: true, message: result.details, result });
		}

		if (action === 'deleteSimUser') {
			if (!userRecordId) {
				return json({ ok: false, message: 'Choose a simulated user to delete.' }, { status: 400 });
			}

			let deletedUser = false;
			try {
				const userRecord = await locals.pb
					.collection('users')
					.getOne<Record<string, unknown>>(userRecordId);
				if (isSimulationUser(userRecord)) {
					await locals.pb.collection('users').delete(userRecordId);
					deletedUser = true;
				} else {
					return json({ ok: false, message: 'User is not marked as simulation.' }, { status: 400 });
				}
			} catch {
				// If user record no longer exists or deletion fails, continue.
			}

			const details = deletedUser
				? 'Deleted simulated user record.'
				: 'Simulated user could not be deleted.';

			const result: SimActionResult = {
				action: 'deleteSimUser',
				ok: true,
				details,
				recordIds: [userRecordId],
				refs: [{ collection: 'users', id: userRecordId }],
				usedFallback: false
			};

			await logSimulationAction({
				pb: locals.pb,
				runId: effectiveRunId,
				questionId,
				actorId: userId,
				actionType: 'deleteSimUser',
				ok: true,
				details,
				input: { userId: userRecordId },
				result
			});

			return json({ ok: true, message: details, result });
		}

		if (action === 'simulateQuestionActivationVotes') {
			const summary = await loadQuestionSummary(locals.pb, questionId);
			const phase = resolveEffectiveSummaryPhase(summary);
			if (phase !== 'Proposed') {
				return json(
					{
						ok: false,
						message: `Action only available in Proposed phase (current phase: ${phase ?? 'Unknown'}).`
					},
					{ status: 400 }
				);
			}

			const runUsers = await listRunUsers(locals.pb, effectiveRunId);
			const runUserIds = runUsers.map((user) => user.id).filter(Boolean);
			const runUserHints = runUsers
				.map((user) => ({
					id: user.id,
					email: user.email,
					username: user.username,
					name: user.name
				}))
				.filter((user) => Boolean(user.id));

			const result = await simulateQuestionActivationVotes({
				pb: locals.pb,
				questionId,
				countRaw: count,
				occurredAtRaw: resolveScheduledStart(startDateRaw),
				spreadDaysRaw,
				userIds: runUserIds,
				userHints: runUserHints
			});

			await logSimulationAction({
				pb: locals.pb,
				runId: effectiveRunId,
				questionId,
				actorId: userId,
				actionType: 'simulateQuestionActivationVotes',
				ok: result.ok,
				details: result.details,
				input: { count: parseCount(count, 1, 100) },
				result
			});

			const phaseRefresh = await loadPhaseRefreshPayload(locals.pb, questionId);

			if (!result.ok) {
				return json(
					{
						ok: false,
						message: result.details,
						result,
						selectedQuestionSummary: phaseRefresh.selectedQuestionSummary,
						activePhaseKey: phaseRefresh.activePhaseKey
					},
					{ status: 400 }
				);
			}

			return json({
				ok: true,
				message: result.details,
				result,
				selectedQuestionSummary: phaseRefresh.selectedQuestionSummary,
				activePhaseKey: phaseRefresh.activePhaseKey
			});
		}

		const ideationActionSet = new Set([
			'initialProposals',
			'remixProposals',
			'voteProgress',
			'proposeMerges',
			'runIdeationBatch'
		]);
		const signalFinalizeSet = new Set(['createFinalBallot']);
		const votingActionSet = new Set(['selectionRankBallots', 'selectionAbstainBallots']);
		const fastForwardActionSet = new Set(['fastForwardPhase']);

		if (
			ideationActionSet.has(action) ||
			signalFinalizeSet.has(action) ||
			votingActionSet.has(action) ||
			fastForwardActionSet.has(action)
		) {
			const summary = await loadQuestionSummary(locals.pb, questionId);
			let questionContext = '';
			try {
				const questionRecord = await locals.pb
					.collection('questions')
					.getOne<Record<string, unknown>>(questionId);
				const description = String(questionRecord.description ?? '').trim();
				const constraints = String(questionRecord.constraints ?? '').trim();
				const tagsJson = String(questionRecord.tags_json ?? '').trim();
				questionContext = [description, constraints, tagsJson]
					.filter(Boolean)
					.join('\n\n')
					.slice(0, 4000);
			} catch {
				questionContext = '';
			}
			const phase = resolveEffectiveSummaryPhase(summary);
			if (fastForwardActionSet.has(action)) {
				if (phase !== 'AnswerSearch' && phase !== 'Voting') {
					return json(
						{
							ok: false,
							message: `Fast-forward simulation action is only available in AnswerSearch or Voting phases (current phase: ${phase ?? 'Unknown'}).`
						},
						{ status: 400 }
					);
				}
			} else if (signalFinalizeSet.has(action)) {
				if (!isIdeationLikePhase(phase)) {
					return json(
						{
							ok: false,
							message: `Finalize simulation is only available in AnswerSearch phase (current phase: ${phase ?? 'Unknown'}).`
						},
						{ status: 400 }
					);
				}
			} else if (votingActionSet.has(action)) {
				if (phase !== 'Voting') {
					return json(
						{
							ok: false,
							message: `Voting simulation actions are only available in Voting phase (current phase: ${phase ?? 'Unknown'}).`
						},
						{ status: 400 }
					);
				}
			} else if (!isIdeationLikePhase(phase)) {
				return json(
					{
						ok: false,
						message: `Ideation simulation actions are only available in AnswerSearch or Ideation phase (current phase: ${phase ?? 'Unknown'}).`
					},
					{ status: 400 }
				);
			}

			const runUsers = await listRunUsers(locals.pb, effectiveRunId);
			const runUserIds = runUsers.map((user) => user.id).filter(Boolean);
			const runUserHints = runUsers
				.map((user) => ({
					id: user.id,
					email: user.email,
					username: user.username,
					name: user.name
				}))
				.filter((user) => Boolean(user.id));

			const runSingleIdeationAction = async (
				actionName: string,
				countRawValue: string
			): Promise<{
				result: SimActionResult;
				logActionType: string;
				input: Record<string, unknown>;
			}> => {
				const occurredAtRaw = resolveScheduledStart(startDateRaw);

				if (actionName === 'initialProposals') {
					const result = await simulateBranchProposals({
						pb: locals.pb,
						questionId,
						questionTitle,
						questionContext,
						countRaw: countRawValue || '5',
						occurredAtRaw,
						spreadDaysRaw,
						forceRoot: true,
						userIds: runUserIds,
						userHints: runUserHints
					});
					return {
						result,
						logActionType: 'initialProposals',
						input: {
							count: parseCount(countRawValue || '5', 5, 20),
							startDate: startDateRaw || null,
							spreadDays: parseSpreadDays(spreadDaysRaw),
							occurredAt: occurredAtRaw,
							mode: 'initial'
						}
					};
				}

				if (actionName === 'remixProposals') {
					const selectedMode = remixMode === 'branch' ? 'branch' : 'merge';
					if (selectedMode === 'branch') {
						const result = await simulateBranchProposals({
							pb: locals.pb,
							questionId,
							questionTitle,
							questionContext,
							countRaw: countRawValue || '5',
							occurredAtRaw,
							spreadDaysRaw,
							forceRoot: false,
							userIds: runUserIds,
							userHints: runUserHints
						});
						return {
							result,
							logActionType: 'branchProposals',
							input: {
								count: parseCount(countRawValue || '5', 5, 20),
								startDate: startDateRaw || null,
								spreadDays: parseSpreadDays(spreadDaysRaw),
								occurredAt: occurredAtRaw,
								mode: 'branch'
							}
						};
					}
					const result = await simulateMergeProposals({
						pb: locals.pb,
						questionId,
						questionTitle,
						questionContext,
						countRaw: countRawValue || '5',
						occurredAtRaw,
						spreadDaysRaw,
						userIds: runUserIds,
						userHints: runUserHints
					});
					return {
						result,
						logActionType: 'mergeProposals',
						input: {
							count: parseCount(countRawValue || '5', 5, 20),
							startDate: startDateRaw || null,
							spreadDays: parseSpreadDays(spreadDaysRaw),
							occurredAt: occurredAtRaw,
							mode: 'merge'
						}
					};
				}

				if (actionName === 'voteProgress') {
					const result = await simulateVotesToProgress({
						pb: locals.pb,
						questionId,
						questionTitle,
						questionContext,
						countRaw: countRawValue || '20',
						occurredAtRaw,
						spreadDaysRaw,
						userIds: runUserIds,
						userHints: runUserHints
					});
					return {
						result,
						logActionType: 'voteProgress',
						input: {
							count: parseCount(countRawValue || '20', 20, 200),
							startDate: startDateRaw || null,
							spreadDays: parseSpreadDays(spreadDaysRaw),
							occurredAt: occurredAtRaw
						}
					};
				}

				if (actionName === 'proposeMerges') {
					const result = await simulateProposeMerges({
						pb: locals.pb,
						questionId,
						questionTitle,
						questionContext,
						countRaw: countRawValue || '5',
						occurredAtRaw: occurredAtRaw || null,
						spreadDaysRaw: spreadDaysRaw || null,
						userIds: runUserIds,
						userHints: runUserHints
					});
					return {
						result,
						logActionType: 'proposeMerges',
						input: {
							count: parseCount(countRawValue || '5', 5, 50),
							startDate: startDateRaw || null
						}
					};
				}

				// createFinalBallot → simulate "Motion to Finalize" by toggling motion_to_finalize on the question
				if (actionName === 'createFinalBallot') {
					const requestedUsers = parseCount(countRawValue || '5', 1, 300);
					if (runUsers.length === 0) {
						return {
							result: {
								action: 'createFinalBallot',
								ok: false,
								details: 'No simulated users are linked to this run. Add users first.',
								recordIds: [],
								refs: [],
								usedFallback: false
							},
							logActionType: 'createFinalBallot',
							input: { requestedUsers }
						};
					}

					// Read existing motion_to_finalize array from the question
					const question = await locals.pb
						.collection('questions')
						.getOne<Record<string, unknown>>(questionId);
					const existingMotion: string[] = Array.isArray(question.motion_to_finalize)
						? (question.motion_to_finalize as string[])
						: [];
					const alreadySignaled = new Set(existingMotion);

					const candidates = runUsers.filter((u) => u.id && !alreadySignaled.has(u.id));
					const target = Math.min(requestedUsers, candidates.length);
					const selected = sampleWithoutReplacement(candidates, target);

					// Add selected users to motion_to_finalize
					const newMotion = [...existingMotion, ...selected.map((u) => u.id).filter(Boolean)];
					await locals.pb.collection('questions').update(questionId, {
						motion_to_finalize: newMotion
					});

					const result: SimActionResult = {
						action: 'createFinalBallot',
						ok: selected.length > 0,
						details: `Added ${selected.length}/${target} "Motion to Finalize" signals to question.`,
						recordIds: selected.map((u) => u.id).filter(Boolean),
						refs: [{ collection: 'questions', id: questionId }],
						usedFallback: false
					};

					return {
						result,
						logActionType: 'createFinalBallot',
						input: { requestedUsers, target, newMotionCount: newMotion.length }
					};
				}

				if (actionName === 'selectionRankBallots') {
					const result = await simulateFinalVotes({
						pb: locals.pb,
						questionId,
						questionTitle,
						questionContext,
						countRaw: countRawValue || '20',
						occurredAtRaw: occurredAtRaw || null,
						spreadDaysRaw: spreadDaysRaw || null,
						userIds: runUserIds,
						userHints: runUserHints
					});
					return {
						result,
						logActionType: 'voteProgress',
						input: {
							count: parseCount(countRawValue || '20', 1, 300)
						}
					};
				}

				if (actionName === 'selectionAbstainBallots') {
					const result = await simulateAbstentions({
						pb: locals.pb,
						questionId,
						countRaw: countRawValue || '20',
						occurredAtRaw: occurredAtRaw || null,
						spreadDaysRaw: spreadDaysRaw || null,
						userIds: runUserIds
					});
					return {
						result,
						logActionType: 'voteProgress',
						input: {
							count: parseCount(countRawValue || '20', 1, 300)
						}
					};
				}

				if (actionName === 'fastForwardPhase') {
					try {
						await locals.pb.send(`/api/custom/simulator/fast-forward/${questionId}`, {
							method: 'POST'
						});
					} catch (e: any) {
						return {
							result: {
								action: 'fastForwardPhase',
								ok: false,
								details: e.message || 'Failed to fast forward phase.',
								recordIds: [],
								refs: [],
								usedFallback: false
							},
							logActionType: 'fastForwardPhase',
							input: {}
						};
					}
					const result = {
						action: 'fastForwardPhase',
						ok: true,
						details: `Fast-forwarded current phase end time to the past.`,
						recordIds: [questionId],
						refs: [{ collection: 'questions', id: questionId }],
						usedFallback: false
					};
					return {
						result,
						logActionType: 'fastForwardPhase',
						input: {}
					};
				}

				// Fallback (unknown action in the set)
				return {
					result: {
						action: actionName,
						ok: false,
						details: `Unknown action: ${actionName}`,
						recordIds: [],
						refs: [],
						usedFallback: false
					},
					logActionType: actionName,
					input: {}
				};
			};

			if (action === 'runIdeationBatch') {
				const allowedBatch = new Set([
					'initialProposals',
					'remixProposals',
					'comments',
					'voteProgress',
					'proposeMerges',
					'createFinalBallot'
				]);
				const orderedDefaults = [
					'initialProposals',
					'remixProposals',
					'voteProgress',
					'proposeMerges'
				];
				const selectedBatch =
					batchActions.length > 0
						? batchActions.filter((name) => allowedBatch.has(name))
						: orderedDefaults;

				if (selectedBatch.length === 0) {
					return json({ ok: false, message: 'Select at least one batch action.' }, { status: 400 });
				}

				const stepResults: Array<Record<string, unknown>> = [];
				const allRefs: Array<{ collection: string; id: string }> = [];
				const allRecordIds: string[] = [];
				let allOk = true;

				for (const stepAction of selectedBatch) {
					const countRawValue =
						stepAction === 'initialProposals'
							? initialCountRaw || count
							: stepAction === 'remixProposals'
								? remixCountRaw || count
								: stepAction === 'voteProgress'
									? votesCountRaw || count
									: stepAction === 'proposeMerges'
										? mergesCountRaw || count
										: proceedCountRaw || count;

					const { result } = await runSingleIdeationAction(stepAction, countRawValue);
					allOk = allOk && result.ok;
					allRefs.push(...result.refs);
					allRecordIds.push(...result.recordIds);
					stepResults.push({ action: stepAction, ok: result.ok, details: result.details });
				}

				const batchResult: SimActionResult = {
					action: 'runIdeationBatch',
					ok: allOk,
					details: `Batch completed ${selectedBatch.length} action(s).`,
					recordIds: allRecordIds,
					refs: allRefs,
					usedFallback: false,
					meta: {
						steps: stepResults
					}
				};

				await logSimulationAction({
					pb: locals.pb,
					runId: effectiveRunId,
					questionId,
					actorId: userId,
					actionType: 'runIdeationBatch',
					ok: batchResult.ok,
					details: batchResult.details,
					input: {
						batchActions: selectedBatch,
						initialCount: parseCount(initialCountRaw || count || '5', 5, 20),
						remixCount: parseCount(remixCountRaw || count || '5', 5, 20),
						votesCount: parseCount(votesCountRaw || count || '20', 20, 200),
						mergesCount: parseCount(mergesCountRaw || count || '5', 5, 50),
						proceedCount: parseCount(proceedCountRaw || count || '10', 10, 300),
						remixMode,
						startDate: startDateRaw || null,
						spreadDays: parseSpreadDays(spreadDaysRaw)
					},
					result: batchResult
				});

				const phaseRefresh = await loadPhaseRefreshPayload(locals.pb, questionId);

				return json({
					ok: batchResult.ok,
					message: `${batchResult.details} ${stepResults
						.map((item) => `${String(item.action)}: ${String(item.ok ? 'ok' : 'failed')}`)
						.join('; ')}`,
					result: batchResult,
					selectedQuestionSummary: phaseRefresh.selectedQuestionSummary,
					activePhaseKey: phaseRefresh.activePhaseKey
				});
			}

			const countRawValue =
				action === 'initialProposals'
					? initialCountRaw || count
					: action === 'remixProposals'
						? remixCountRaw || count
						: action === 'voteProgress'
							? votesCountRaw || count
							: action === 'proposeMerges'
								? mergesCountRaw || count
								: proceedCountRaw || count;

			const { result, logActionType, input } = await runSingleIdeationAction(action, countRawValue);

			await logSimulationAction({
				pb: locals.pb,
				runId: effectiveRunId,
				questionId,
				actorId: userId,
				actionType: logActionType,
				ok: result.ok,
				details: result.details,
				input,
				result
			});

			const phaseRefresh = await loadPhaseRefreshPayload(locals.pb, questionId);

			return json({
				ok: result.ok,
				message: result.details,
				result,
				selectedQuestionSummary: phaseRefresh.selectedQuestionSummary,
				activePhaseKey: phaseRefresh.activePhaseKey
			});
		}

		return json({ ok: false, message: 'Unknown action.' }, { status: 400 });
	} catch (err) {
		if (isMissingSimulationCollectionsError(err)) {
			return json(
				{
					ok: false,
					message:
						'Simulation storage is not ready yet. Run dev:restart to apply migrations, then retry.'
				},
				{ status: 400 }
			);
		}
		const message = err instanceof Error ? err.message : 'Simulation action failed.';
		return json({ ok: false, message }, { status: 400 });
	}
};
