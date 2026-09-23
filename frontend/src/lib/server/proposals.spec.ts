import { describe, it, expect } from 'vitest';
import { normalizeProposalRecord } from './proposals';

// ─── normalizeProposalRecord ─────────────────────────────────────────────────

describe('normalizeProposalRecord', () => {
	function makeRawRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
		return {
			id: 'sol_001',
			question: 'prob_001',
			author: 'user_001',
			title: 'Test Proposal',
			content: '<p>Some content</p>',
			reason_for_change: '',
			parent_proposals: [],
			root_proposal: '',
			branch_parent: '',
			branch_depth: 0,
			state: 'Proposed',

			subscription_count: 0,
			opposition_count: 0,
			in_focus: false,
			occurred_at: '',
			activated_at: '',
			grace_deadline_at: '',
			is_champion: false,

			created: '2026-01-01T00:00:00.000Z',
			updated: '2026-01-01T00:00:00.000Z',
			expand: { author: { name: 'Test User' } },
			...overrides
		};
	}

	it('normalizes a complete record with all default fields', () => {
		const raw = makeRawRecord();
		const result = normalizeProposalRecord(raw);

		expect(result.id).toBe('sol_001');
		expect(result.question).toBe('prob_001');
		expect(result.author).toBe('user_001');
		expect(result.title).toBe('Test Proposal');
		expect(result.state).toBe('Proposed');
		expect(result.subscription_count).toBe(0);
		expect(result.in_focus).toBe(false);
		expect(result.is_champion).toBe(false);
		expect(result.parent_proposals).toEqual([]);
	});

	it('preserves subscription_count from the database', () => {
		const raw = makeRawRecord({
			subscription_count: 5
		});
		const result = normalizeProposalRecord(raw);

		expect(result.subscription_count).toBe(5);
	});

	it('preserves in_focus boolean', () => {
		const raw = makeRawRecord({ in_focus: true });
		const result = normalizeProposalRecord(raw);
		expect(result.in_focus).toBe(true);
	});

	// ── State normalization ──────────────────────────────────────────────

	it('normalizes known states', () => {
		expect(normalizeProposalRecord(makeRawRecord({ state: 'Proposed' })).state).toBe('Proposed');
		expect(normalizeProposalRecord(makeRawRecord({ state: 'FinalWinner' })).state).toBe(
			'FinalWinner'
		);
		expect(normalizeProposalRecord(makeRawRecord({ state: 'Deactivated' })).state).toBe(
			'Deactivated'
		);
		expect(normalizeProposalRecord(makeRawRecord({ state: 'Inactive' })).state).toBe('Inactive');
	});

	it('defaults unknown state to Proposed', () => {
		expect(normalizeProposalRecord(makeRawRecord({ state: 'SomeGarbage' })).state).toBe('Proposed');
		expect(normalizeProposalRecord(makeRawRecord({ state: '' })).state).toBe('Proposed');
		expect(normalizeProposalRecord(makeRawRecord({ state: null })).state).toBe('Proposed');
	});

	// ── Relation normalization ───────────────────────────────────────────

	it('normalizes parent_proposals from array and string', () => {
		expect(
			normalizeProposalRecord(makeRawRecord({ parent_proposals: ['a', 'b'] })).parent_proposals
		).toEqual(['a', 'b']);
		expect(
			normalizeProposalRecord(makeRawRecord({ parent_proposals: 'a' })).parent_proposals
		).toEqual(['a']);
		expect(
			normalizeProposalRecord(makeRawRecord({ parent_proposals: [] })).parent_proposals
		).toEqual([]);
	});

	it('extracts author_name from expand', () => {
		const raw = makeRawRecord({
			expand: { author: { name: 'Alice' } }
		});
		expect(normalizeProposalRecord(raw).author_name).toBe('Alice');
	});

	it('falls back to username from expand when name is missing', () => {
		const raw = makeRawRecord({
			expand: { author: { username: 'alice42' } }
		});
		expect(normalizeProposalRecord(raw).author_name).toBe('alice42');
	});

	it('returns empty author_name when expand has no author', () => {
		const raw = makeRawRecord({ expand: {} });
		expect(normalizeProposalRecord(raw).author_name).toBe('');
	});

	// ── Numeric field clamping ───────────────────────────────────────────

	it('clamps negative subscription_count to 0', () => {
		const raw = makeRawRecord({ subscription_count: -5 });
		expect(normalizeProposalRecord(raw).subscription_count).toBe(0);
	});

	it('rounds fractional vote counts', () => {
		const raw = makeRawRecord({ subscription_count: 2.7 });
		const result = normalizeProposalRecord(raw);
		expect(result.subscription_count).toBe(3);
	});

	// ── Title normalization ──────────────────────────────────────────────

	it('uses "Untitled proposal" for empty/missing titles', () => {
		expect(normalizeProposalRecord(makeRawRecord({ title: '' })).title).toBe('Untitled proposal');
		expect(normalizeProposalRecord(makeRawRecord({ title: '   ' })).title).toBe(
			'Untitled proposal'
		);
		expect(normalizeProposalRecord(makeRawRecord({ title: null })).title).toBe('Untitled proposal');
	});

	it('trims whitespace from title', () => {
		expect(normalizeProposalRecord(makeRawRecord({ title: '  Hello  ' })).title).toBe('Hello');
	});
});
