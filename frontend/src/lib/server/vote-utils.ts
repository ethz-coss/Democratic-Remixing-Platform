import { error } from '@sveltejs/kit';

export function toNumber(value: unknown, fallback: number) {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}

	return fallback;
}

/**
 * Normalize a vote value to the binary Support/Retract set: 1 or 0.
 * Returns 0 for invalid/missing values.
 */
export function normalizeVoteValue(value: unknown): number {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value > 0 ? 1 : 0;
	}

	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) {
			return parsed > 0 ? 1 : 0;
		}
	}

	return 0;
}

/**
 * Parse a vote value from form data. Accepts 1 (Support) or 0 (retract).
 */
export function parseVoteValue(raw: FormDataEntryValue | null): number {
	if (raw === null || raw === undefined) {
		throw error(400, 'Vote value is required.');
	}

	const parsed = Number(raw);
	if (!Number.isFinite(parsed)) {
		throw error(400, 'Vote must be 1 (Support) or 0 (Retract).');
	}

	return parsed > 0 ? 1 : 0;
}

function extractRelationId(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}

	if (Array.isArray(value) && typeof value[0] === 'string') {
		return value[0];
	}

	return '';
}

interface VoteRecordWithRelation {
	vote?: unknown;
	user?: unknown;
}

export function buildScoreMap<T extends VoteRecordWithRelation>(
	votes: T[],
	relationSelector: (vote: T) => unknown
) {
	const scores: Record<string, number> = {};

	for (const vote of votes) {
		const relationId = extractRelationId(relationSelector(vote));
		if (!relationId) {
			continue;
		}

		const numericVote = normalizeVoteValue(vote.vote);
		if (numericVote === 0) {
			continue;
		}

		scores[relationId] = (scores[relationId] ?? 0) + numericVote;
	}

	return scores;
}

export function buildUserVoteMap<T extends VoteRecordWithRelation>(
	votes: T[],
	userId: string,
	relationSelector: (vote: T) => unknown
) {
	const userVotes: Record<string, number> = {};

	for (const vote of votes) {
		if (String(vote.user ?? '') !== userId) {
			continue;
		}

		const relationId = extractRelationId(relationSelector(vote));
		if (!relationId) {
			continue;
		}

		userVotes[relationId] = normalizeVoteValue(vote.vote);
	}

	return userVotes;
}
