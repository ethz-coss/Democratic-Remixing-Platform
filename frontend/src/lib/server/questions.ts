import { error } from '@sveltejs/kit';
import type PocketBase from 'pocketbase';
import { ClientResponseError } from 'pocketbase';
import {
	buildScoreMap,
	buildUserVoteMap as buildGenericUserVoteMap,
	normalizeVoteValue,
	toNumber
} from '$lib/server/vote-utils';
import { stripRichText } from '$lib/markdown';
import { normalizeSingleRelation } from '$lib/server/normalize';

export { parseVoteValue } from '$lib/server/vote-utils';

const STATUS_PROPOSED = 'Proposed';
const STATUS_ACTIVE_WORKSPACE = 'AnswerSearch';
const STATUS_FINAL_VOTE = 'Voting';
const DEFAULT_SELECTION_TRIGGER_THRESHOLD_PERCENT = 60;
const DEFAULT_DEACTIVATION_THRESHOLD_PERCENT = 10;
const DEFAULT_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_RESOLVE_THRESHOLD_PERCENT = 50;

function normalizePhaseName(raw: unknown): App.QuestionRecord['current_phase_name'] {
	const phase = String(raw ?? '').trim();

	// Canonical fluid phases
	if (phase === 'AnswerSearch') return STATUS_ACTIVE_WORKSPACE;
	if (phase === 'Voting') return STATUS_FINAL_VOTE;
	if (phase === STATUS_PROPOSED) return STATUS_PROPOSED;
	if (phase === 'Decided') return 'Decided' as App.QuestionRecord['current_phase_name'];

	// Legacy phase mapping
	if (
		phase === 'Ideation' ||
		phase === 'Active_Ideation' ||
		phase === 'Salvage_Improve' ||
		phase === 'Salvage' ||
		phase === 'Mapping' ||
		phase === 'Selection' ||
		phase === 'SelectionPhase' ||
		phase === 'Structure' ||
		phase === 'Exploration'
	) {
		return STATUS_ACTIVE_WORKSPACE;
	}

	if (phase === 'FinalReproposal' || phase === 'FinalResolution' || phase === 'Resolved_Voting') {
		return STATUS_FINAL_VOTE;
	}

	if (phase === 'Closing' || phase === 'Closing_Window' || phase === 'closing_window') {
		return 'Closing' as App.QuestionRecord['current_phase_name'];
	}

	if (phase === 'Proposed_Question' || phase === 'ProposedQuestion') {
		return STATUS_PROPOSED;
	}

	return STATUS_PROPOSED;
}

function normalizeConstraints(raw: unknown): string[] {
	if (Array.isArray(raw)) {
		return raw
			.map((value) => {
				if (typeof value === 'string') return value.trim();
				if (typeof value === 'object' && value !== null && 'description' in value) {
					return String((value as { description: unknown }).description ?? '').trim();
				}
				return '';
			})
			.filter((value) => value.length > 0)
			.slice(0, 20);
	}

	if (typeof raw === 'string') {
		try {
			const parsed = JSON.parse(raw);
			return normalizeConstraints(parsed);
		} catch {
			return raw
				.split('\n')
				.map((value) => value.trim())
				.filter((value) => value.length > 0)
				.slice(0, 20);
		}
	}

	return [];
}

function normalizeTagsByRole(raw: unknown): Record<string, string[]> {
	const roleMap: Record<string, string[]> = {};

	const toUniqueList = (input: unknown): string[] => {
		if (!Array.isArray(input)) return [];
		const seen = new Set<string>();
		const out: string[] = [];
		for (const value of input) {
			const next = String(value ?? '').trim();
			if (!next || seen.has(next)) continue;
			seen.add(next);
			out.push(next);
		}
		return out;
	};

	if (Array.isArray(raw)) {
		roleMap.general = toUniqueList(raw);
		return roleMap;
	}

	if (!raw || typeof raw !== 'object') {
		return { general: [] };
	}

	for (const [role, value] of Object.entries(raw as Record<string, unknown>)) {
		const roleKey = String(role ?? '')
			.trim()
			.toLowerCase();
		if (!roleKey) continue;
		roleMap[roleKey] = toUniqueList(value);
	}

	if (!Object.keys(roleMap).length) {
		roleMap.general = [];
	}

	return roleMap;
}

function flattenTagsByRole(tagsByRole: Record<string, string[]>): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const tags of Object.values(tagsByRole)) {
		for (const tag of tags) {
			if (!tag || seen.has(tag)) continue;
			seen.add(tag);
			out.push(tag);
		}
	}
	return out;
}

export function normalizeQuestionRecord(record: Record<string, unknown>): App.QuestionRecord {
	const expandedCurrentPhase =
		record.expand && typeof record.expand === 'object'
			? (record.expand as Record<string, unknown>).current_phase
			: null;
	const expandedCurrentPhaseName =
		expandedCurrentPhase && typeof expandedCurrentPhase === 'object'
			? (expandedCurrentPhase as Record<string, unknown>).phase_name
			: null;
	const currentPhaseName = normalizePhaseName(
		record.current_phase_name ?? expandedCurrentPhaseName
	);

	return {
		id: String(record.id ?? ''),
		author: String(record.author ?? ''),
		title: String(record.title ?? ''),
		description: String(record.description ?? ''),
		constraints: normalizeConstraints(record.constraints),
		current_phase: normalizeSingleRelation(record.current_phase),
		current_phase_name: currentPhaseName,
		discussion_deadline: record.discussion_deadline
			? String(record.discussion_deadline)
			: new Date(
					new Date(String(record.occurred_at || record.created || '')).getTime() +
						14 * 24 * 60 * 60 * 1000
				)
					.toISOString()
					.replace('T', ' '),
		closing_window_deadline: record.closing_window_deadline
			? String(record.closing_window_deadline)
			: undefined,
		vote_deadline: record.vote_deadline ? String(record.vote_deadline) : undefined,
		focus_quorum: Math.max(0, Math.round(toNumber(record.focus_quorum, 0))),
		visibility: (record.visibility as any) || 'Public',
		group: record.group ? String(record.group) : undefined,
		invite_token: record.invite_token ? String(record.invite_token) : undefined,
		score: 0,
		created: String(record.occurred_at || record.created || ''),
		updated: String(record.updated ?? '')
	};
}

export function escapeFilter(input: string) {
	return input.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

export function buildQuestionScoreMap(votes: App.QuestionVoteRecord[]) {
	return buildScoreMap(votes, (vote) => vote.question);
}

export function buildUserVoteMap(votes: App.QuestionVoteRecord[], userId: string) {
	return buildGenericUserVoteMap(votes, userId, (vote) => vote.question);
}

export function deriveQuestionState(
	question: App.QuestionRecord,
	score: number
): App.QuestionRecord {
	return {
		...question,
		score: Math.round(score)
	};
}

export function sortQuestionsByScoreAndCreated(questions: App.QuestionRecord[]) {
	return [...questions].sort((left, right) => {
		if (right.score !== left.score) {
			return right.score - left.score;
		}
		return Date.parse(right.created) - Date.parse(left.created);
	});
}

function validateQuestionPayload(payload: {
	title: string;
	description: string;
	constraints: string[];
	selectionTriggerThresholdPercent: number;
}) {
	const title = payload.title.trim();
	const description = payload.description.trim();
	const descriptionText = stripRichText(description);
	const constraints = payload.constraints.map((value) => value.trim()).filter(Boolean);
	const thresholdPercent = Math.round(Number(payload.selectionTriggerThresholdPercent));

	if (title.length < 5 || title.length > 150) {
		throw new Error('Title must be between 5 and 150 characters.');
	}

	if (descriptionText.length < 20 || descriptionText.length > 6000) {
		throw new Error('Description must be between 20 and 6000 characters.');
	}

	if (constraints.length > 20) {
		throw new Error('Use at most 20 constraints.');
	}

	if (!Number.isFinite(thresholdPercent) || thresholdPercent < 1 || thresholdPercent > 100) {
		throw new Error('Selection trigger threshold must be a whole number from 1 to 100.');
	}

	return {
		title,
		description,
		constraints,
		selectionTriggerThresholdPercent: thresholdPercent
	};
}

function buildQuestionTagsByRole(rawTags: string[], role = 'general') {
	const roleKey = role.trim().toLowerCase() || 'general';
	const tags = rawTags
		.map((value) => value.trim())
		.filter(Boolean)
		.slice(0, 20);
	return { [roleKey]: Array.from(new Set(tags)) };
}

export function getPocketBaseErrorMessage(err: unknown, fallbackMessage: string): string {
	const asMessage = (value: unknown): string | null => {
		if (typeof value === 'string' && value.trim()) {
			return value;
		}

		if (Array.isArray(value)) {
			let nonTextMessage: string | null = null;
			for (const entry of value) {
				const nested = asMessage(entry);
				if (nested) {
					if (typeof entry === 'string') {
						return nested;
					}

					nonTextMessage = nonTextMessage ?? nested;
				}
			}

			return nonTextMessage;
		}

		if (value && typeof value === 'object') {
			if ('message' in value) {
				return asMessage((value as { message?: unknown }).message);
			}

			for (const nestedValue of Object.values(value as Record<string, unknown>)) {
				const nested = asMessage(nestedValue);
				if (nested) {
					return nested;
				}
			}
		}

		return null;
	};

	if (!(err instanceof ClientResponseError)) {
		if (err instanceof Error) {
			const extracted = asMessage(err.message);
			if (extracted) {
				return extracted;
			}
		}

		return fallbackMessage;
	}

	const detailData = err.response?.data;
	if (detailData && typeof detailData === 'object') {
		for (const [key, value] of Object.entries(detailData)) {
			const message = asMessage(value);
			if (message) {
				return `${key}: ${message}`;
			}
		}
	}

	const responseMessage = asMessage(err.response?.message);
	if (responseMessage) {
		return responseMessage;
	}

	const errorMessage = asMessage(err.message);
	if (errorMessage) {
		return errorMessage;
	}

	return fallbackMessage;
}

export function parseQuestionPayloadFromFormData(formData: FormData) {
	const rawConstraintsJson = String(formData.get('constraintsJson') ?? '').trim();
	let constraints: string[] = [];

	if (rawConstraintsJson) {
		try {
			const parsed = JSON.parse(rawConstraintsJson);
			if (Array.isArray(parsed)) {
				constraints = parsed.map((value) => String(value).trim()).filter(Boolean);
			}
		} catch {
			// Fall back to repeated constraints fields below.
		}
	}

	if (constraints.length === 0) {
		constraints = formData
			.getAll('constraints')
			.map((value) => String(value).trim())
			.filter(Boolean);
	}

	return validateQuestionPayload({
		title: String(formData.get('title') ?? ''),
		description: String(formData.get('description') ?? ''),
		constraints,
		selectionTriggerThresholdPercent: Number(
			String(formData.get('selectionTriggerThresholdPercent') ?? '').trim()
		)
	});
}

async function listVotesForUserQuestion(pb: PocketBase, userId: string, questionId: string) {
	return pb.collection('question_votes').getFullList<App.QuestionVoteRecord>({
		filter: `user="${escapeFilter(userId)}" && question="${escapeFilter(questionId)}"`
	});
}

export async function countVotesForQuestion(pb: PocketBase, questionId: string) {
	const result = await pb.collection('question_votes').getList(1, 1, {
		filter: `question="${escapeFilter(questionId)}" && vote>0`,
		$autoCancel: false
	});
	return result.totalItems;
}

export interface SubmitQuestionVoteInput {
	pb: PocketBase;
	userId: string;
	questionId: string;
	voteValue: number;
}

export interface SubmitQuestionVoteResult {
	userVote: number;
	score: number;
}

export async function submitQuestionVote({
	pb,
	userId,
	questionId,
	voteValue
}: SubmitQuestionVoteInput): Promise<SubmitQuestionVoteResult> {
	const currentQuestion = normalizeQuestionRecord(
		await pb.collection('questions').getOne(questionId)
	);
	const currentScore = await countVotesForQuestion(pb, questionId);

	if (currentQuestion.current_phase_name === STATUS_ACTIVE_WORKSPACE) {
		throw error(400, 'Voting is closed for this question. Enter the workspace instead.');
	}

	if (currentQuestion.current_phase_name === STATUS_FINAL_VOTE) {
		throw error(400, 'Voting is closed. This question is in the Final Vote phase.');
	}

	const existingVotes = await listVotesForUserQuestion(pb, userId, questionId);

	const previousVote = normalizeVoteValue(existingVotes[0]?.vote ?? 0);
	let nextVote: number = voteValue;
	let mutationError: unknown = null;

	try {
		if (existingVotes.length === 0) {
			await pb.collection('question_votes').create({
				user: userId,
				question: questionId,
				vote: voteValue
			});
			nextVote = voteValue;
		} else {
			const existingVote = existingVotes[0];

			if (normalizeVoteValue(existingVote.vote) === voteValue) {
				await pb.collection('question_votes').delete(existingVote.id);
				nextVote = 0;
			} else {
				await pb.collection('question_votes').update(existingVote.id, {
					user: userId,
					question: questionId,
					vote: voteValue
				});
				nextVote = voteValue;
			}
		}
	} catch (err) {
		mutationError = err;
	}

	let nextScore = currentScore + (nextVote - previousVote);

	// Read back final state so clients stay in sync even after flaky mutation responses.
	try {
		const latestUserVotes = await listVotesForUserQuestion(pb, userId, questionId);
		const normalized = normalizeVoteValue(latestUserVotes[0]?.vote ?? 0);
		nextVote = normalized === 1 || normalized === -1 ? normalized : 0;

		nextScore = await countVotesForQuestion(pb, questionId);
	} catch {
		if (mutationError) {
			throw mutationError;
		}
	}

	return {
		userVote: nextVote,
		score: nextScore
	};
}
