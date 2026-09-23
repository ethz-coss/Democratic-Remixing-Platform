/**
 * Tests for dag-interaction.svelte.ts — specifically filterDagProposals.
 *
 * NOTE: This module uses Svelte runes ($state inside feedViewState), but the
 * filterDagProposals function itself is purely synchronous and can be tested
 * directly without a DOM/browser environment.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock SvelteKit modules used by dag-interaction
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: vi.fn((p: string) => p) }));
vi.mock('$app/state', () => ({
	page: {
		url: { searchParams: { get: vi.fn(() => null) } }
	}
}));
vi.mock('$lib/editor.svelte', () => ({
	editorState: { phase: '', parentA: null, parentB: null, isOpen: false }
}));

// Mock feedViewState for controlled testing
const mockFeedViewState = {
	subView: 'ideas' as const,
	onlySupported: false,
	onlyAuthored: false,
	onlyInFocus: false,
	onlyChampions: false,
	onlyCombinations: false,
	onlyImprovements: false,
	groupByCluster: false,
	selectedClusterIdx: null,
	championIds: new Set<string>(),
	searchQuery: ''
};

vi.mock('$lib/feedView.svelte', () => ({
	feedViewState: mockFeedViewState,
	getFilterState: vi.fn(() => mockFeedViewState)
}));

// Import after mocks
const { filterDagProposals } = await import('$lib/dag/dag-interaction.svelte');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeProposal(overrides: Partial<App.ProposalRecord> = {}): App.ProposalRecord {
	return {
		id: 'p1',
		title: 'Test Proposal',
		content: 'Test content',
		author: 'user1',
		question: 'q1',
		subscription_count: 5,
		parent_proposals: [],
		in_focus: false,
		state: 'Proposed',
		created: new Date(Date.now() - 3600000).toISOString(),
		updated: new Date().toISOString(),
		primary_label: null,
		root_proposal: null,
		...overrides
	} as unknown as App.ProposalRecord;
}

function resetState() {
	mockFeedViewState.onlySupported = false;
	mockFeedViewState.onlyAuthored = false;
	mockFeedViewState.onlyInFocus = false;
	mockFeedViewState.onlyChampions = false;
	mockFeedViewState.onlyCombinations = false;
	mockFeedViewState.onlyImprovements = false;
	mockFeedViewState.championIds = new Set();
	mockFeedViewState.searchQuery = '';
}

// ─── filterDagProposals — 'ideas' tab ──────────────────────────────────────────

describe('filterDagProposals — all tab', () => {
	beforeEach(resetState);

	it('returns all proposals when no filters active', () => {
		const proposals = [makeProposal({ id: 'p1' }), makeProposal({ id: 'p2' })];
		const result = filterDagProposals(proposals, 'ideas', null, {}, 'user1');
		expect(result).toHaveLength(2);
	});

	it('filters to only supported proposals when onlySupported=true', () => {
		mockFeedViewState.onlySupported = true;
		const proposals = [makeProposal({ id: 'p1' }), makeProposal({ id: 'p2' })];
		const result = filterDagProposals(proposals, 'ideas', null, { p1: 5 }, 'user1');
		expect(result.map((p) => p.id)).toContain('p1');
		expect(result.map((p) => p.id)).not.toContain('p2');
	});

	it('filters to only authored proposals when onlyAuthored=true', () => {
		mockFeedViewState.onlyAuthored = true;
		const proposals = [
			makeProposal({ id: 'p1', author: 'user1' }),
			makeProposal({ id: 'p2', author: 'user2' })
		];
		const result = filterDagProposals(proposals, 'ideas', null, {}, 'user1');
		expect(result.map((p) => p.id)).toContain('p1');
		expect(result.map((p) => p.id)).not.toContain('p2');
	});

	it('filters to only in-focus proposals when onlyInFocus=true', () => {
		mockFeedViewState.onlyInFocus = true;
		const proposals = [
			makeProposal({ id: 'p1', in_focus: true }),
			makeProposal({ id: 'p2', in_focus: false })
		];
		const result = filterDagProposals(proposals, 'ideas', null, {}, 'user1');
		expect(result.map((p) => p.id)).toContain('p1');
		expect(result.map((p) => p.id)).not.toContain('p2');
	});

	it('filters to only champions when onlyChampions=true', () => {
		mockFeedViewState.onlyChampions = true;
		mockFeedViewState.championIds = new Set(['p1']);
		const proposals = [makeProposal({ id: 'p1' }), makeProposal({ id: 'p2' })];
		const result = filterDagProposals(proposals, 'ideas', null, {}, 'user1');
		expect(result.map((p) => p.id)).toContain('p1');
		expect(result.map((p) => p.id)).not.toContain('p2');
	});

	it('filters to only combinations when onlyCombinations=true', () => {
		mockFeedViewState.onlyCombinations = true;
		const proposals = [
			makeProposal({ id: 'p1', parent_proposals: ['a', 'b'] }),
			makeProposal({ id: 'p2', parent_proposals: ['a'] })
		];
		const result = filterDagProposals(proposals, 'ideas', null, {}, 'user1');
		expect(result.map((p) => p.id)).toContain('p1');
		expect(result.map((p) => p.id)).not.toContain('p2');
	});

	it('filters to only improvements when onlyImprovements=true', () => {
		mockFeedViewState.onlyImprovements = true;
		const proposals = [
			makeProposal({ id: 'p1', parent_proposals: ['a', 'b'] }),
			makeProposal({ id: 'p2', parent_proposals: ['a'] }),
			makeProposal({ id: 'p3', parent_proposals: [] })
		];
		const result = filterDagProposals(proposals, 'ideas', null, {}, 'user1');
		expect(result.map((p) => p.id)).toEqual(['p2']);
	});

	it('includes ancestor trail for filtered proposals', () => {
		mockFeedViewState.onlyInFocus = true;
		// p1 is in focus and has parent p_root
		const proposals = [
			makeProposal({ id: 'p_root', in_focus: false }),
			makeProposal({ id: 'p1', in_focus: true, parent_proposals: ['p_root'] })
		];
		const result = filterDagProposals(proposals, 'ideas', null, {}, 'user1');
		// Ancestor p_root should be included in the graph for context
		expect(result.map((p) => p.id)).toContain('p_root');
		expect(result.map((p) => p.id)).toContain('p1');
	});

	it('filters by search query on title', () => {
		mockFeedViewState.searchQuery = 'Climate Policy';
		const proposals = [
			makeProposal({ id: 'p1', title: 'Climate Policy Action' }),
			makeProposal({ id: 'p2', title: 'Housing Reform Plan' })
		];
		const result = filterDagProposals(proposals, 'ideas', null, {}, 'user1');
		expect(result.map((p) => p.id)).toContain('p1');
		expect(result.map((p) => p.id)).not.toContain('p2');
	});

	it('filters by search query on content (fuzzy)', () => {
		mockFeedViewState.searchQuery = 'renewable energy';
		const proposals = [
			makeProposal({
				id: 'p1',
				title: 'Policy A',
				content: 'This involves renewable energy sources'
			}),
			makeProposal({ id: 'p2', title: 'Policy B', content: 'This is about taxation' })
		];
		const result = filterDagProposals(proposals, 'ideas', null, {}, 'user1');
		expect(result.map((p) => p.id)).toContain('p1');
	});

	it('returns empty array when search matches nothing', () => {
		mockFeedViewState.searchQuery = 'xyzzy_nonexistent_gibberish_zyx';
		const proposals = [makeProposal({ id: 'p1', title: 'Normal Proposal' })];
		const result = filterDagProposals(proposals, 'ideas', null, {}, 'user1');
		expect(result).toHaveLength(0);
	});
});

// ─── filterDagProposals — 'ideas' tab ──────────────────────────────────────────

describe('filterDagProposals — map tab', () => {
	beforeEach(resetState);

	it('returns all proposals when no filters active on map tab', () => {
		const proposals = [makeProposal({ id: 'p1' }), makeProposal({ id: 'p2' })];
		const result = filterDagProposals(proposals, 'ideas', null, {}, 'user1');
		expect(result).toHaveLength(2);
	});

	it('applies filters on map tab (not just all tab)', () => {
		mockFeedViewState.onlyInFocus = true;
		const proposals = [
			makeProposal({ id: 'p1', in_focus: true }),
			makeProposal({ id: 'p2', in_focus: false })
		];
		const result = filterDagProposals(proposals, 'ideas', null, {}, 'user1');
		expect(result.map((p) => p.id)).toContain('p1');
		expect(result.map((p) => p.id)).not.toContain('p2');
	});

	it('applies search query on map tab', () => {
		mockFeedViewState.searchQuery = 'Climate';
		const proposals = [
			makeProposal({ id: 'p1', title: 'Climate Plan' }),
			makeProposal({ id: 'p2', title: 'Housing Reform' })
		];
		const result = filterDagProposals(proposals, 'ideas', null, {}, 'user1');
		expect(result.map((p) => p.id)).toContain('p1');
		expect(result.map((p) => p.id)).not.toContain('p2');
	});
});

// ─── filterDagProposals — 'ballot' tab ───────────────────────────────────────

describe('filterDagProposals — ballot tab', () => {
	beforeEach(resetState);

	it('shows only in_focus proposals on ballot tab', () => {
		const proposals = [
			makeProposal({ id: 'p1', in_focus: true }),
			makeProposal({ id: 'p2', in_focus: false })
		];
		const result = filterDagProposals(proposals, 'ballot', null, {}, 'user1');
		expect(result.map((p) => p.id)).toContain('p1');
		expect(result.map((p) => p.id)).not.toContain('p2');
	});

	it('does NOT apply chip filters on ballot tab (ignores onlySupported)', () => {
		mockFeedViewState.onlySupported = true;
		const proposals = [
			makeProposal({ id: 'p1', in_focus: true }), // in focus but not supported
			makeProposal({ id: 'p2', in_focus: false })
		];
		// On ballot tab, onlySupported is ignored — only in_focus matters
		const result = filterDagProposals(proposals, 'ballot', null, {}, 'user1');
		expect(result.map((p) => p.id)).toContain('p1');
	});

	it('does NOT apply search query on ballot tab', () => {
		mockFeedViewState.searchQuery = 'Climate';
		const proposals = [
			makeProposal({ id: 'p1', in_focus: true, title: 'Housing Reform' }), // in focus, no match
			makeProposal({ id: 'p2', in_focus: false, title: 'Climate Policy' }) // not in focus, matches
		];
		const result = filterDagProposals(proposals, 'ballot', null, {}, 'user1');
		// Ballot is not affected by search — only in_focus matters
		expect(result.map((p) => p.id)).toContain('p1');
		expect(result.map((p) => p.id)).not.toContain('p2');
	});
});

// ─── filterDagProposals — proposal/question tab ───────────────────────────────

describe('filterDagProposals — non-feed tabs', () => {
	beforeEach(resetState);

	it('returns lineage of active proposal on proposal detail tab', () => {
		const proposals = [makeProposal({ id: 'p1' }), makeProposal({ id: 'p2' })];
		const result = filterDagProposals(proposals, 'proposal', 'p1', {}, 'user1');
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('p1');
	});

	it('returns all proposals on question tab', () => {
		const proposals = [makeProposal({ id: 'p1' }), makeProposal({ id: 'p2' })];
		const result = filterDagProposals(proposals, 'question', null, {}, 'user1');
		expect(result).toHaveLength(2);
	});
});
