import { describe, it, expect } from 'vitest';
import { computeLocalNeighborhood } from './local-neighborhood';

describe('computeLocalNeighborhood', () => {
	it('should return empty if focus node is not found', () => {
		const result = computeLocalNeighborhood('missing', []);
		expect(result.nodes.length).toBe(0);
	});

	it('should correctly identify tiers', () => {
		const proposals: any[] = [
			{ id: 'focus', parent_proposals: ['source1'], labels: ['L1'], primary_label: 'L1' },
			{ id: 'source1', parent_proposals: [], labels: [], primary_label: '' },
			{ id: 'iteration1', parent_proposals: ['focus'], labels: [], primary_label: '' },
			{
				id: 'topic1',
				parent_proposals: [],
				labels: ['L1'],
				primary_label: 'L1',
				subscription_count: 5
			},
			{
				id: 'topic2',
				parent_proposals: [],
				labels: ['L1'],
				primary_label: 'L2',
				subscription_count: 10
			}
		];

		const result = computeLocalNeighborhood('focus', proposals, { cap: 12 });

		expect(result.nodes.length).toBe(5);
		expect(result.nodeTypes.get('focus')).toBe('self');
		expect(result.nodeTypes.get('source1')).toBe('source');
		expect(result.nodeTypes.get('iteration1')).toBe('iteration');
		expect(result.nodeTypes.get('topic1')).toBe('topic-peer');
		expect(result.nodeTypes.get('topic2')).toBe('topic-peer');
	});
});
