import { describe, expect, it } from 'vitest';
import { selectBallot } from './ballot-engine.js';

describe('ballot-engine: selectBallot', () => {
	it('3 champions, maxSlots=7 -> all 3 on ballot', () => {
		const champions = [
			{ id: 'c1', subscription_count: 5, created: '2026-01-01', labels: ['L1'] },
			{ id: 'c2', subscription_count: 3, created: '2026-01-01', labels: ['L2'] },
			{ id: 'c3', subscription_count: 8, created: '2026-01-01', labels: ['L3'] }
		];
		const result = selectBallot(champions, 7);
		expect(result.length).toBe(3);
		expect(result[0].id).toBe('c3'); // Highest score
		expect(result[1].id).toBe('c1');
		expect(result[2].id).toBe('c2');
	});

	it('10 champions, maxSlots=7 -> top 7 by subscription_count', () => {
		const champions = Array.from({ length: 10 }).map((_, i) => ({
			id: `c${i}`,
			subscription_count: i, // 0 to 9
			created: '2026-01-01',
			labels: [`L${i}`]
		}));
		const result = selectBallot(champions, 7);
		expect(result.length).toBe(7);
		expect(result[0].id).toBe('c9');
		expect(result[6].id).toBe('c3');
	});

	it('Tie on subscription_count -> higher label_support_score wins', () => {
		const champions = [
			{ id: 'c1', subscription_count: 5, created: '2026-01-01', label_support_score: 10, labels: ['L1'] },
			{ id: 'c2', subscription_count: 5, created: '2026-01-02', label_support_score: 50, labels: ['L2'] }
		];
		const result = selectBallot(champions, 7);
		expect(result[0].id).toBe('c2'); // Higher label_support_score
		expect(result[1].id).toBe('c1');
	});

	it('Tie on subscription_count and label_support_score -> oldest created wins', () => {
		const champions = [
			{ id: 'c1', subscription_count: 5, created: '2026-01-02', label_support_score: 30, labels: ['L1'] },
			{ id: 'c2', subscription_count: 5, created: '2026-01-01', label_support_score: 30, labels: ['L2'] } // Older
		];
		const result = selectBallot(champions, 7);
		expect(result[0].id).toBe('c2');
		expect(result[1].id).toBe('c1');
	});

	it('Tie on subscription_count, no label_support_score -> oldest created wins (backward compat)', () => {
		const champions = [
			{ id: 'c1', subscription_count: 5, created: '2026-01-02' },
			{ id: 'c2', subscription_count: 5, created: '2026-01-01' } // Older
		];
		const result = selectBallot(champions, 7);
		expect(result[0].id).toBe('c2');
		expect(result[1].id).toBe('c1');
	});

	it('Empty champions -> empty ballot', () => {
		expect(selectBallot([], 7)).toEqual([]);
	});

	it('Exactly 7 champions -> all on ballot', () => {
		const champions = Array.from({ length: 7 }).map((_, i) => ({
			id: `c${i}`,
			subscription_count: i + 2,
			created: '2026-01-01',
			labels: [`L${i}`]
		}));
		expect(selectBallot(champions, 7).length).toBe(7);
	});

	it('1 champion -> ballot of 1', () => {
		const champions = [{ id: 'c1', subscription_count: 5, created: '2026-01-01', labels: ['L1'] }];
		expect(selectBallot(champions, 7).length).toBe(1);
	});

	it('Custom maxSlots (e.g., 3) -> respects limit', () => {
		const champions = Array.from({ length: 5 }).map((_, i) => ({
			id: `c${i}`,
			subscription_count: i + 2,
			created: '2026-01-01',
			labels: [`L${i}`]
		}));
		expect(selectBallot(champions, 3).length).toBe(3);
	});

	it('Order is deterministic: same input -> same output', () => {
		const champions = [
			{ id: 'c1', subscription_count: 5, created: '2026-01-02', labels: ['L1'] },
			{ id: 'c2', subscription_count: 5, created: '2026-01-01', labels: ['L2'] }
		];
		const result1 = selectBallot(champions, 7);
		const result2 = selectBallot(champions, 7);
		expect(result1).toEqual(result2);
	});

	it('Champions sorted correctly when subscription_counts are all equal', () => {
		const champions = [
			{ id: 'c1', subscription_count: 5, created: '2026-01-03', labels: ['L1'] },
			{ id: 'c2', subscription_count: 5, created: '2026-01-01', labels: ['L2'] },
			{ id: 'c3', subscription_count: 5, created: '2026-01-02', labels: ['L3'] }
		];
		const result = selectBallot(champions, 7);
		expect(result[0].id).toBe('c2');
		expect(result[1].id).toBe('c3');
		expect(result[2].id).toBe('c1');
	});

	// ── Label overlap exclusion tests ─────────────────────────────────────

	it('Two champions sharing a label -> only the higher-scored one enters ballot', () => {
		const champions = [
			{ id: 'c1', subscription_count: 10, created: '2026-01-01', labels: ['Housing', 'Economics'] },
			{ id: 'c2', subscription_count: 5, created: '2026-01-01', labels: ['Economics', 'Transport'] }
		];
		const result = selectBallot(champions, 7);
		expect(result.length).toBe(1);
		expect(result[0].id).toBe('c1'); // c2 excluded because 'Economics' already on ballot
	});

	it('Champion excluded by label overlap, but next non-overlapping champion admitted', () => {
		const champions = [
			{ id: 'c1', subscription_count: 10, created: '2026-01-01', labels: ['Housing', 'Economics'] },
			{ id: 'c2', subscription_count: 8, created: '2026-01-01', labels: ['Economics'] }, // Blocked
			{ id: 'c3', subscription_count: 6, created: '2026-01-01', labels: ['Transport'] }   // Admitted
		];
		const result = selectBallot(champions, 7);
		expect(result.length).toBe(2);
		expect(result[0].id).toBe('c1');
		expect(result[1].id).toBe('c3');
		expect(result.find(b => b.id === 'c2')).toBeUndefined();
	});

	it('Champion with multiple labels blocks multiple subsequent champions', () => {
		const champions = [
			{ id: 'c1', subscription_count: 10, created: '2026-01-01', labels: ['A', 'B', 'C'] },
			{ id: 'c2', subscription_count: 8, created: '2026-01-01', labels: ['A'] },   // Blocked by 'A'
			{ id: 'c3', subscription_count: 6, created: '2026-01-01', labels: ['B'] },   // Blocked by 'B'
			{ id: 'c4', subscription_count: 4, created: '2026-01-01', labels: ['C'] },   // Blocked by 'C'
			{ id: 'c5', subscription_count: 3, created: '2026-01-01', labels: ['D'] }    // Admitted
		];
		const result = selectBallot(champions, 7);
		expect(result.length).toBe(2);
		expect(result[0].id).toBe('c1');
		expect(result[1].id).toBe('c5');
	});

	it('No labels -> champions still admitted (no overlap possible)', () => {
		const champions = [
			{ id: 'c1', subscription_count: 5, created: '2026-01-01', labels: [] },
			{ id: 'c2', subscription_count: 3, created: '2026-01-01', labels: [] }
		];
		const result = selectBallot(champions, 7);
		expect(result.length).toBe(2);
	});

	it('Champions without labels property -> treated as no labels (backward compat)', () => {
		const champions = [
			{ id: 'c1', subscription_count: 5, created: '2026-01-01' },
			{ id: 'c2', subscription_count: 3, created: '2026-01-01' }
		];
		const result = selectBallot(champions, 7);
		expect(result.length).toBe(2);
	});
});
