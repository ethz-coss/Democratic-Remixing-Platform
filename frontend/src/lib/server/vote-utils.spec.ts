import { describe, it, expect } from 'vitest';
import {
	normalizeVoteValue,
	parseVoteValue,
	buildScoreMap,
	buildUserVoteMap,
	toNumber
} from './vote-utils';

// ─── toNumber ────────────────────────────────────────────────────────────────

describe('toNumber', () => {
	it('returns the number if finite', () => {
		expect(toNumber(42, 0)).toBe(42);
		expect(toNumber(-3.14, 0)).toBe(-3.14);
		expect(toNumber(0, 99)).toBe(0);
	});

	it('parses numeric strings', () => {
		expect(toNumber('7', 0)).toBe(7);
		expect(toNumber('-2.5', 0)).toBe(-2.5);
		expect(toNumber('0', 99)).toBe(0);
	});

	it('returns fallback for non-numeric values', () => {
		expect(toNumber(null, 5)).toBe(5);
		expect(toNumber(undefined, 5)).toBe(5);
		expect(toNumber('', 5)).toBe(5);
		expect(toNumber('abc', 5)).toBe(5);
		expect(toNumber(NaN, 5)).toBe(5);
		expect(toNumber(Infinity, 5)).toBe(5);
		expect(toNumber({}, 5)).toBe(5);
	});
});

// ─── normalizeVoteValue ──────────────────────────────────────────────────────

describe('normalizeVoteValue', () => {
	it('normalizes positive values to 1 (Support)', () => {
		expect(normalizeVoteValue(1)).toBe(1);
		expect(normalizeVoteValue(5)).toBe(1);
		expect(normalizeVoteValue(10)).toBe(1);
		expect(normalizeVoteValue(100)).toBe(1);
	});

	it('normalizes negative values to 0 (Retract)', () => {
		expect(normalizeVoteValue(-1)).toBe(0);
		expect(normalizeVoteValue(-5)).toBe(0);
	});

	it('passes through zero', () => {
		expect(normalizeVoteValue(0)).toBe(0);
	});

	it('parses string values', () => {
		expect(normalizeVoteValue('1')).toBe(1);
		expect(normalizeVoteValue('0')).toBe(0);
		expect(normalizeVoteValue('7')).toBe(1);
	});

	it('returns 0 for invalid/missing values', () => {
		expect(normalizeVoteValue(null)).toBe(0);
		expect(normalizeVoteValue(undefined)).toBe(0);
		expect(normalizeVoteValue('')).toBe(0);
		expect(normalizeVoteValue('abc')).toBe(0);
		expect(normalizeVoteValue(NaN)).toBe(0);
		expect(normalizeVoteValue({})).toBe(0);
	});
});

// ─── parseVoteValue ──────────────────────────────────────────────────────────

describe('parseVoteValue', () => {
	it('parses valid binary vote values', () => {
		expect(parseVoteValue('1')).toBe(1);
		expect(parseVoteValue('0')).toBe(0);
	});

	it('clamps out-of-range values to binary', () => {
		expect(parseVoteValue('5')).toBe(1);
		expect(parseVoteValue('-10')).toBe(0);
	});

	it('rounds fractional values to binary', () => {
		expect(parseVoteValue('1.6')).toBe(1);
		expect(parseVoteValue('0.3')).toBe(1);
	});

	it('throws for null/undefined', () => {
		expect(() => parseVoteValue(null)).toThrow();
	});

	it('throws for non-numeric strings', () => {
		expect(() => parseVoteValue('abc')).toThrow();
	});
});

// ─── buildScoreMap ───────────────────────────────────────────────────────────

describe('buildScoreMap', () => {
	interface MockVote {
		vote?: unknown;
		user?: unknown;
		proposal?: string;
	}

	const selector = (v: MockVote) => v.proposal;

	it('counts numeric support votes (+1) correctly', () => {
		const votes: MockVote[] = [
			{ vote: 1, user: 'u1', proposal: 's1' },
			{ vote: 1, user: 'u2', proposal: 's1' },
			{ vote: 1, user: 'u3', proposal: 's1' }
		];
		const scores = buildScoreMap(votes, selector);
		expect(scores['s1']).toBe(3);
	});

	it('handles multiple proposals independently', () => {
		const votes: MockVote[] = [
			{ vote: 1, user: 'u1', proposal: 's1' },
			{ vote: 0, user: 'u2', proposal: 's2' },
			{ vote: 1, user: 'u3', proposal: 's2' }
		];
		const scores = buildScoreMap(votes, selector);
		expect(scores['s1']).toBe(1);
		expect(scores['s2']).toBe(1);
	});

	it('ignores zero-value votes', () => {
		const votes: MockVote[] = [
			{ vote: 0, user: 'u1', proposal: 's1' },
			{ vote: 1, user: 'u2', proposal: 's1' }
		];
		const scores = buildScoreMap(votes, selector);
		expect(scores['s1']).toBe(1);
	});

	it('returns empty object for no votes', () => {
		const scores = buildScoreMap([], selector);
		expect(scores).toEqual({});
	});
});

// ─── buildUserVoteMap ────────────────────────────────────────────────────────

describe('buildUserVoteMap', () => {
	interface MockVote {
		vote?: unknown;
		user?: unknown;
		proposal?: string;
	}

	const selector = (v: MockVote) => v.proposal;

	it("returns only the specified user's votes", () => {
		const votes: MockVote[] = [
			{ vote: 1, user: 'u1', proposal: 's1' },
			{ vote: 0, user: 'u2', proposal: 's1' },
			{ vote: 1, user: 'u1', proposal: 's2' }
		];
		const map = buildUserVoteMap(votes, 'u1', selector);
		expect(map['s1']).toBe(1);
		expect(map['s2']).toBe(1);
		expect(map).not.toHaveProperty('u2');
	});

	it('returns empty map for user with no votes', () => {
		const votes: MockVote[] = [{ vote: 1, user: 'u1', proposal: 's1' }];
		const map = buildUserVoteMap(votes, 'u2', selector);
		expect(map).toEqual({});
	});

	it('maps correct vote values per proposal', () => {
		const votes: MockVote[] = [
			{ vote: 1, user: 'u1', proposal: 's1' },
			{ vote: 0, user: 'u1', proposal: 's2' }
		];
		const map = buildUserVoteMap(votes, 'u1', selector);
		expect(map['s1']).toBe(1);
		expect(map['s2']).toBe(0);
	});
});
