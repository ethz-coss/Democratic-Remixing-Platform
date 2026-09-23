/**
 * Tests for the pure filter/sort/group utilities in feed-filter.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
	filterProposals,
	sortProposals,
	groupProposalsByLabel,
	getTrendingScore,
	getNeedsAttentionScore,
	getPersonalizedScore,
	getFuzzyMatchIds,
	type FilterOptions
} from '$lib/services/feed-filter';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeProposal(overrides: Partial<App.ProposalRecord> = {}): App.ProposalRecord {
	return {
		id: 'p1',
		title: 'Test Proposal',
		content: 'This is the content of the proposal',
		author: 'user1',
		question: 'q1',
		subscription_count: 5,
		parent_proposals: [],
		in_focus: false,
		state: 'Proposed',
		created: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
		updated: new Date().toISOString(),
		primary_label: null,
		root_proposal: null,
		...overrides
	} as unknown as App.ProposalRecord;
}

function makeOpts(overrides: Partial<FilterOptions> = {}): FilterOptions {
	return {
		onlySupported: false,
		onlyAuthored: false,
		onlyInFocus: false,
		onlyChampions: false,
		onlyCombinations: false,
		onlyImprovements: false,
		onlyUnseen: false,
		onlyHidden: false,
		userVotes: {},
		userId: 'user1',
		userHiddenProposalIds: new Set(),
		championIds: new Set(),
		searchQuery: '',
		...overrides
	};
}

// ─── filterProposals ──────────────────────────────────────────────────────────

describe('filterProposals', () => {
	const injected = new Set<string>();

	it('returns all non-winner proposals when no filters active', () => {
		const proposals = [
			makeProposal({ id: 'p1' }),
			makeProposal({ id: 'p2', state: 'FinalWinner' }),
			makeProposal({ id: 'p3' })
		];
		const result = filterProposals(proposals, injected, makeOpts());
		// FinalWinner excluded
		expect(result.map((p) => p.id)).not.toContain('p2');
		expect(result).toHaveLength(2);
	});

	it('filters to only supported proposals when onlySupported=true', () => {
		const proposals = [makeProposal({ id: 'p1' }), makeProposal({ id: 'p2' })];
		const opts = makeOpts({ onlySupported: true, userVotes: { p1: 5, p2: 0 } });
		const result = filterProposals(proposals, injected, opts);
		expect(result.map((p) => p.id)).toEqual(['p1']);
	});

	it('filters to only authored proposals when onlyAuthored=true', () => {
		const proposals = [
			makeProposal({ id: 'p1', author: 'user1' }),
			makeProposal({ id: 'p2', author: 'user2' })
		];
		const opts = makeOpts({ onlyAuthored: true, userId: 'user1' });
		const result = filterProposals(proposals, injected, opts);
		expect(result.map((p) => p.id)).toEqual(['p1']);
	});

	it('filters to only in-focus proposals when onlyInFocus=true', () => {
		const proposals = [
			makeProposal({ id: 'p1', in_focus: true }),
			makeProposal({ id: 'p2', in_focus: false })
		];
		const result = filterProposals(proposals, injected, makeOpts({ onlyInFocus: true }));
		expect(result.map((p) => p.id)).toEqual(['p1']);
	});

	it('filters to only champions when onlyChampions=true', () => {
		const proposals = [makeProposal({ id: 'p1' }), makeProposal({ id: 'p2' })];
		const opts = makeOpts({ onlyChampions: true, championIds: new Set(['p1']) });
		const result = filterProposals(proposals, injected, opts);
		expect(result.map((p) => p.id)).toEqual(['p1']);
	});

	it('filters to only combinations (2+ parents) when onlyCombinations=true', () => {
		const proposals = [
			makeProposal({ id: 'p1', parent_proposals: ['a', 'b'] }),
			makeProposal({ id: 'p2', parent_proposals: ['a'] }),
			makeProposal({ id: 'p3', parent_proposals: [] })
		];
		const result = filterProposals(proposals, injected, makeOpts({ onlyCombinations: true }));
		expect(result.map((p) => p.id)).toEqual(['p1']);
	});

	it('filters to only improvements (1 parent) when onlyImprovements=true', () => {
		const proposals = [
			makeProposal({ id: 'p1', parent_proposals: ['a', 'b'] }),
			makeProposal({ id: 'p2', parent_proposals: ['a'] }),
			makeProposal({ id: 'p3', parent_proposals: [] })
		];
		const result = filterProposals(proposals, injected, makeOpts({ onlyImprovements: true }));
		expect(result.map((p) => p.id)).toEqual(['p2']);
	});

	it('combines multiple filters with AND logic', () => {
		const proposals = [
			makeProposal({ id: 'p1', author: 'user1', in_focus: true }),
			makeProposal({ id: 'p2', author: 'user1', in_focus: false }),
			makeProposal({ id: 'p3', author: 'user2', in_focus: true })
		];
		const opts = makeOpts({ onlyAuthored: true, onlyInFocus: true, userId: 'user1' });
		const result = filterProposals(proposals, injected, opts);
		expect(result.map((p) => p.id)).toEqual(['p1']);
	});

	it('temporarily injected parents bypass all filters', () => {
		const proposals = [
			makeProposal({ id: 'p1', state: 'FinalWinner' }),
			makeProposal({ id: 'p2', author: 'user2' })
		];
		const injectedWithParent = new Set(['p1']);
		const opts = makeOpts({ onlyAuthored: true, userId: 'user1' });
		const result = filterProposals(proposals, injectedWithParent, opts);
		// p1 (FinalWinner) passes because it's injected; p2 fails authored filter
		expect(result.map((p) => p.id)).toEqual(['p1']);
	});

	it('returns empty array when no proposals match combined filters', () => {
		const proposals = [makeProposal({ id: 'p1', in_focus: false })];
		const result = filterProposals(proposals, injected, makeOpts({ onlyInFocus: true }));
		expect(result).toHaveLength(0);
	});

	it('filters by search query on title (fuzzy)', () => {
		const proposals = [
			makeProposal({ id: 'p1', title: 'Universal Basic Income' }),
			makeProposal({ id: 'p2', title: 'Carbon Tax Reform' })
		];
		const result = filterProposals(proposals, injected, makeOpts({ searchQuery: 'basic income' }));
		expect(result.map((p) => p.id)).toContain('p1');
		expect(result.map((p) => p.id)).not.toContain('p2');
	});

	it('filters by search query on content (fuzzy, case-insensitive)', () => {
		const proposals = [
			makeProposal({
				id: 'p1',
				title: 'Policy A',
				content: 'This involves renewable energy sources'
			}),
			makeProposal({ id: 'p2', title: 'Policy B', content: 'This is about taxation reform' })
		];
		const result = filterProposals(
			proposals,
			injected,
			makeOpts({ searchQuery: 'renewable energy' })
		);
		expect(result.map((p) => p.id)).toContain('p1');
	});

	it('search + filter pills combine correctly (AND logic)', () => {
		const proposals = [
			makeProposal({ id: 'p1', title: 'Climate Policy', in_focus: true }),
			makeProposal({ id: 'p2', title: 'Climate Action', in_focus: false }),
			makeProposal({ id: 'p3', title: 'Housing Reform', in_focus: true })
		];
		const opts = makeOpts({ searchQuery: 'climate', onlyInFocus: true });
		const result = filterProposals(proposals, injected, opts);
		expect(result.map((p) => p.id)).toEqual(['p1']);
	});

	it('returns all when search query is too short (< 2 chars)', () => {
		const proposals = [makeProposal({ id: 'p1' }), makeProposal({ id: 'p2' })];
		const result = filterProposals(proposals, injected, makeOpts({ searchQuery: 'a' }));
		expect(result).toHaveLength(2);
	});
});

// ─── sortProposals ────────────────────────────────────────────────────────────

describe('sortProposals', () => {
	function makeProposalWithAge(id: string, hoursAgo: number, support: number): App.ProposalRecord {
		return makeProposal({
			id,
			subscription_count: support,
			created: new Date(Date.now() - hoursAgo * 3600000).toISOString()
		});
	}

	it('sorts by Newest (descending created date)', () => {
		const proposals = [
			makeProposalWithAge('p1', 10, 5),
			makeProposalWithAge('p2', 1, 2),
			makeProposalWithAge('p3', 5, 3)
		];
		const sorted = sortProposals([...proposals], 'Newest');
		expect(sorted.map((p) => p.id)).toEqual(['p2', 'p3', 'p1']);
	});

	it('sorts by TopSupport (descending subscription_count)', () => {
		const proposals = [
			makeProposalWithAge('p1', 5, 3),
			makeProposalWithAge('p2', 5, 10),
			makeProposalWithAge('p3', 5, 1)
		];
		const sorted = sortProposals([...proposals], 'TopSupport');
		expect(sorted.map((p) => p.id)).toEqual(['p2', 'p1', 'p3']);
	});

	it('sorts by Alphabetical (ascending title)', () => {
		const proposals = [
			makeProposal({ id: 'p1', title: 'Zebra Plan' }),
			makeProposal({ id: 'p2', title: 'Alpha Solution' }),
			makeProposal({ id: 'p3', title: 'Middle Ground' })
		];
		const sorted = sortProposals([...proposals], 'Alphabetical');
		expect(sorted.map((p) => p.id)).toEqual(['p2', 'p3', 'p1']);
	});

	it('sorts by Trending (higher subscription_count / (hours + 1) first)', () => {
		const proposals = [
			makeProposalWithAge('p1', 100, 5), // trending score ≈ 0.05
			makeProposalWithAge('p2', 1, 10), // trending score ≈ 5
			makeProposalWithAge('p3', 5, 3) // trending score ≈ 0.5
		];
		const sorted = sortProposals([...proposals], 'Trending');
		expect(sorted[0].id).toBe('p2');
	});

	it('sorts by NeedsAttention (hours_since_creation / max(1, support) descending)', () => {
		// Old, low-support proposals should surface first
		const proposals = [
			makeProposalWithAge('p1', 1, 100), // very supported, new → low score
			makeProposalWithAge('p2', 200, 1), // old, barely supported → very high score
			makeProposalWithAge('p3', 50, 5) // middle
		];
		const sorted = sortProposals([...proposals], 'NeedsAttention');
		expect(sorted[0].id).toBe('p2'); // p2 needs most attention
	});

	it('NeedsAttention surfaces old low-support proposals first', () => {
		const proposals = [
			makeProposalWithAge('fresh_popular', 2, 50),
			makeProposalWithAge('old_ignored', 500, 0)
		];
		const sorted = sortProposals([...proposals], 'NeedsAttention');
		expect(sorted[0].id).toBe('old_ignored');
	});
});

// ─── getTrendingScore / getNeedsAttentionScore ────────────────────────────────

describe('scoring functions', () => {
	it('getTrendingScore: newer proposals with high support score higher', () => {
		const old = makeProposal({
			subscription_count: 10,
			created: new Date(Date.now() - 100 * 3600000).toISOString()
		});
		const fresh = makeProposal({
			subscription_count: 10,
			created: new Date(Date.now() - 1 * 3600000).toISOString()
		});
		expect(getTrendingScore(fresh)).toBeGreaterThan(getTrendingScore(old));
	});

	it('getNeedsAttentionScore: higher for old low-support, lower for new popular', () => {
		const neglected = makeProposal({
			subscription_count: 0,
			created: new Date(Date.now() - 500 * 3600000).toISOString()
		});
		const popular = makeProposal({
			subscription_count: 100,
			created: new Date(Date.now() - 1 * 3600000).toISOString()
		});
		expect(getNeedsAttentionScore(neglected)).toBeGreaterThan(getNeedsAttentionScore(popular));
	});

	it('getPersonalizedScore: unseen boost', () => {
		const p = makeProposal({
			subscription_count: 10,
			created: new Date(Date.now() - 100 * 3600000).toISOString()
		});
		const seenScore = getPersonalizedScore(p, true, 0);
		const unseenScore = getPersonalizedScore(p, false, 0);
		expect(unseenScore).toBeCloseTo(seenScore * 2.0);
	});

	it('getPersonalizedScore: label affinity boost', () => {
		const p = makeProposal({ subscription_count: 10, labels: ['L1'] });
		const noAffinityMap = new Map<string, number>();
		const highAffinityMap = new Map<string, number>([['L1', 9]]);

		const novelScore = getPersonalizedScore(p, true, 0, noAffinityMap);
		const familiarScore = getPersonalizedScore(p, true, 0, highAffinityMap);

		// New logic: we BOOST familiar labels to help users find their niche
		expect(familiarScore).toBeGreaterThan(novelScore);
	});

	it('getPersonalizedScore: exploration boost for unseen items', () => {
		const pFewViews = makeProposal({ subscription_count: 0 });
		(pFewViews as any).unique_viewer_count = 0;

		const pManyViews = makeProposal({ subscription_count: 0 });
		(pManyViews as any).unique_viewer_count = 100;

		const scoreFew = getPersonalizedScore(pFewViews, true, 0);
		const scoreMany = getPersonalizedScore(pManyViews, true, 0);

		// Items with fewer views should get a higher exploration boost
		expect(scoreFew).toBeGreaterThan(scoreMany);
	});

	it('getPersonalizedScore: subscribed penalty', () => {
		const p = makeProposal({ subscription_count: 10 });
		const unsubscribedScore = getPersonalizedScore(p, true, 0);
		const subscribedScore = getPersonalizedScore(p, true, 1);
		expect(subscribedScore).toBeCloseTo(unsubscribedScore * 0.1);
	});
});

// ─── getFuzzyMatchIds ─────────────────────────────────────────────────────────

describe('getFuzzyMatchIds', () => {
	const proposals = [
		makeProposal({ id: 'p1', title: 'Universal Basic Income', content: 'Give everyone money' }),
		makeProposal({ id: 'p2', title: 'Carbon Tax', content: 'Tax fossil fuels' }),
		makeProposal({ id: 'p3', title: 'Healthcare Reform', content: 'Universal health coverage' })
	];

	it('returns null when query is empty', () => {
		expect(getFuzzyMatchIds(proposals, '')).toBeNull();
	});

	it('returns null when query is too short (< 2 chars)', () => {
		expect(getFuzzyMatchIds(proposals, 'u')).toBeNull();
	});

	it('returns matching IDs for exact title match', () => {
		const matches = getFuzzyMatchIds(proposals, 'Carbon Tax');
		expect(matches).not.toBeNull();
		expect(matches!.has('p2')).toBe(true);
	});

	it('matches despite minor typos (fuzzy)', () => {
		const matches = getFuzzyMatchIds(proposals, 'Univeral'); // typo
		expect(matches).not.toBeNull();
		// Should still find Universal Basic Income or Universal health coverage
		expect(matches!.size).toBeGreaterThan(0);
	});

	it('matches content text (not just title)', () => {
		const matches = getFuzzyMatchIds(proposals, 'fossil fuels');
		expect(matches).not.toBeNull();
		expect(matches!.has('p2')).toBe(true);
	});
});

// ─── groupProposalsByLabel ──────────────────────────────────────────────────

describe('groupProposalsByLabel', () => {
	const labels = [
		{ id: 'l_eco', short_name: 'Economy', color: '#blue' } as App.LabelRecord,
		{ id: 'l_env', short_name: 'Environment', color: '#green' } as App.LabelRecord
	];

	it('groups proposals by primary_label correctly', () => {
		const proposals = [
			makeProposal({ id: 'p1', primary_label: 'l_eco', subscription_count: 10 }),
			makeProposal({ id: 'p2', primary_label: 'l_eco', subscription_count: 4 }),
			makeProposal({ id: 'p3', primary_label: 'l_env', subscription_count: 5 })
		];
		const groups = groupProposalsByLabel(proposals, labels, 'Trending');
		expect(groups).toHaveLength(2);
		const ecoGroup = groups.find((g) => g.commonTitle === 'Economy');
		expect(ecoGroup?.proposals).toHaveLength(2);
	});

	it('sorts cluster groups by champion score descending', () => {
		const proposals = [
			makeProposal({ id: 'p1', primary_label: 'l_eco', subscription_count: 10 }),
			makeProposal({ id: 'p2', primary_label: 'l_eco', subscription_count: 4 }),
			makeProposal({ id: 'p3', primary_label: 'l_env', subscription_count: 5 })
		];
		const groups = groupProposalsByLabel(proposals, labels, 'Trending');
		// Economy has max subscription count 10, Environment has 5 -> Economy first
		expect(groups[0].commonTitle).toBe('Economy');
	});

	it('handles unclustered proposals in a __none__ group', () => {
		const proposals = [
			makeProposal({ id: 'p1', primary_label: 'l_eco' }),
			makeProposal({ id: 'pX' }) // not in any label
		];
		const groups = groupProposalsByLabel(proposals, labels, 'Trending');
		const noneGroup = groups.find((g) => g.labelId === '__none__');
		expect(noneGroup).toBeDefined();
		expect(noneGroup?.proposals.map((p) => p.id)).toContain('pX');
	});
});
