import { describe, expect, it } from 'vitest';
import { identifyChampions } from './label-engine.js';

describe('label-engine: identifyChampions', () => {
	it('Single proposal per label -> that proposal is champion', () => {
		const proposals = [
			{ id: 'p1', primary_label: 'L1', subscription_count: 5, created: '2026-01-01' }
		];
		const result = identifyChampions(proposals);
		expect(Object.keys(result).length).toBe(1);
		expect(result['L1'].id).toBe('p1');
	});

	it('Multiple proposals same label -> highest subscription_count wins', () => {
		const proposals = [
			{ id: 'p1', primary_label: 'L1', subscription_count: 5, created: '2026-01-01' },
			{ id: 'p2', primary_label: 'L1', subscription_count: 10, created: '2026-01-02' }
		];
		const result = identifyChampions(proposals);
		expect(result['L1'].id).toBe('p2');
	});

	it('Tie on subscription_count -> higher label_support_score wins', () => {
		const proposals = [
			{ id: 'p1', primary_label: 'L1', subscription_count: 10, created: '2026-01-01', label_support_score: 20 },
			{ id: 'p2', primary_label: 'L1', subscription_count: 10, created: '2026-01-02', label_support_score: 50 }
		];
		const result = identifyChampions(proposals);
		expect(result['L1'].id).toBe('p2'); // Higher label_support_score
	});

	it('Tie on subscription_count and label_support_score -> oldest created date wins', () => {
		const proposals = [
			{ id: 'p1', primary_label: 'L1', subscription_count: 10, created: '2026-01-02', label_support_score: 30 },
			{ id: 'p2', primary_label: 'L1', subscription_count: 10, created: '2026-01-01', label_support_score: 30 } // Older
		];
		const result = identifyChampions(proposals);
		expect(result['L1'].id).toBe('p2');
	});

	it('Tie on subscription_count, no label_support_score -> oldest created date wins (backward compat)', () => {
		const proposals = [
			{ id: 'p1', primary_label: 'L1', subscription_count: 10, created: '2026-01-02' },
			{ id: 'p2', primary_label: 'L1', subscription_count: 10, created: '2026-01-01' } // Older
		];
		const result = identifyChampions(proposals);
		expect(result['L1'].id).toBe('p2');
	});

	it('Proposals across 3 labels -> one champion per label', () => {
		const proposals = [
			{ id: 'p1', primary_label: 'L1', subscription_count: 5, created: '2026-01-01' },
			{ id: 'p2', primary_label: 'L2', subscription_count: 8, created: '2026-01-01' },
			{ id: 'p3', primary_label: 'L3', subscription_count: 1, created: '2026-01-01' }
		];
		const result = identifyChampions(proposals);
		expect(Object.keys(result).length).toBe(3);
		expect(result['L1'].id).toBe('p1');
		expect(result['L2'].id).toBe('p2');
		expect(result['L3'].id).toBe('p3');
	});

	it('Proposal with primary_label = null -> skipped', () => {
		const proposals = [
			{ id: 'p1', primary_label: null, subscription_count: 5, created: '2026-01-01' },
			{ id: 'p2', primary_label: 'L1', subscription_count: 1, created: '2026-01-01' }
		];
		const result = identifyChampions(proposals);
		expect(Object.keys(result).length).toBe(1);
		expect(result['L1'].id).toBe('p2');
	});

	it('Empty proposal list -> empty champions map', () => {
		const result = identifyChampions([]);
		expect(Object.keys(result).length).toBe(0);
	});

	it('All proposals same label -> only one champion returned', () => {
		const proposals = [
			{ id: 'p1', primary_label: 'L1', subscription_count: 1, created: '2026-01-01' },
			{ id: 'p2', primary_label: 'L1', subscription_count: 2, created: '2026-01-02' },
			{ id: 'p3', primary_label: 'L1', subscription_count: 3, created: '2026-01-03' }
		];
		const result = identifyChampions(proposals);
		expect(Object.keys(result).length).toBe(1);
		expect(result['L1'].id).toBe('p3');
	});

	it('subscription_count of 0 -> still eligible as champion', () => {
		const proposals = [
			{ id: 'p1', primary_label: 'L1', subscription_count: 0, created: '2026-01-01' }
		];
		const result = identifyChampions(proposals);
		expect(Object.keys(result).length).toBe(1);
		expect(result['L1'].id).toBe('p1');
	});
});
