import { describe, expect, it } from 'vitest';
import { toCardProps } from './proposalCardData.js';

describe('toCardProps label resolution', () => {
	const mockContext = {
		clusters: new Map([['L1', { short_name: 'Economy', color: '#f00' }]]),
		labels: [
			{ id: 'L1', short_name: 'Economy', color: '#f00', question: 'q1', created: '', updated: '' },
			{
				id: 'L2',
				short_name: 'Environment',
				color: '#0f0',
				question: 'q1',
				created: '',
				updated: ''
			}
		]
	};

	const mockProposal = {
		id: 'p1',
		title: 'Test',
		content: 'Content',
		author: 'a1',
		question: 'q1',
		created: '2026-01-01',
		updated: '2026-01-01',
		primary_label: 'L1',
		labels: ['L1', 'L2'],
		subscription_count: 5,
		in_focus: false,
		is_champion: false,
		parent_proposals: [],
		ancestor_proposals: []
	} as unknown as App.ProposalRecord;

	it('resolves activeLabels from proposal.labels + context.labels', () => {
		const props = toCardProps(mockProposal, mockContext as any);
		expect(props.activeLabels).toBeDefined();
		expect(props.activeLabels?.length).toBe(2);
		expect(props.activeLabels?.[0]).toEqual({ id: 'L1', short_name: 'Economy', color: '#f00' });
		expect(props.activeLabels?.[1]).toEqual({ id: 'L2', short_name: 'Environment', color: '#0f0' });
	});

	it('returns empty activeLabels when proposal has no labels', () => {
		const props = toCardProps({ ...mockProposal, labels: [] } as any, mockContext as any);
		expect(props.activeLabels).toEqual([]);
	});

	it('handles missing labels in context gracefully', () => {
		const props = toCardProps(
			{ ...mockProposal, labels: ['L1', 'L_MISSING'] } as any,
			mockContext as any
		);
		expect(props.activeLabels?.length).toBe(1);
		expect(props.activeLabels?.[0].id).toBe('L1');
	});

	it('still computes clusterColor/clusterTitle from primary_label for backward compatibility', () => {
		const props = toCardProps(mockProposal, mockContext as any);
		expect(props.clusterColor).toBe('#f00');
		expect(props.clusterTitle).toBe('Economy');
	});

	it('maps unseenImprovementCount from context.unseenImprovements', () => {
		const contextWithUnseen = {
			...mockContext,
			unseenImprovements: { p1: 3 }
		};
		const props = toCardProps(mockProposal, contextWithUnseen as any);
		expect(props.unseenImprovementCount).toBe(3);
	});

	it('defaults unseenImprovementCount to 0 when missing in context', () => {
		const props = toCardProps(mockProposal, mockContext as any);
		expect(props.unseenImprovementCount).toBe(0);
	});
});
