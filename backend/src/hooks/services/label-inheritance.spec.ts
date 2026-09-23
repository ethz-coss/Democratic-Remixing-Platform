import { describe, expect, it } from 'vitest';
import { enforceLabelRules } from './label-rules.js';

describe('Label Inheritance', () => {
	it('child of single parent inherits all labels', () => {
		const res = enforceLabelRules({
			parentCount: 1,
			labelStr: '',
			title: '',
			parentLabels: [['A', 'B']],
			parentPrimaryLabels: ['A']
		});
		
		expect(res.resolvedLabels()).toEqual(['A', 'B']);
	});

	it('child of multiple parents gets union of labels (deduped)', () => {
		const res = enforceLabelRules({
			parentCount: 2,
			labelStr: '',
			title: '',
			parentLabels: [['A', 'B'], ['B', 'C']],
			parentPrimaryLabels: ['A', 'C']
		});
		
		expect(res.resolvedLabels()).toEqual(['A', 'B', 'C']);
	});

	it('child inherits primary_label from first parent', () => {
		const res = enforceLabelRules({
			parentCount: 2,
			labelStr: '',
			title: '',
			parentLabels: [['A', 'B'], ['B', 'C']],
			parentPrimaryLabels: ['A', 'C']
		});
		
		expect(res.resolvedPrimaryLabel()).toBe('A');
	});

	it('orphan proposal (no parents) keeps its own labels (simulated as root idea creating a label)', () => {
		const res = enforceLabelRules({
			parentCount: 0,
			labelStr: 'X',
			title: '',
			parentLabels: [],
			parentPrimaryLabels: []
		});
		
		expect(res.resolvedLabels('X')).toEqual(['X']);
		expect(res.resolvedPrimaryLabel('X')).toBe('X');
	});

	it('proposal with empty labels array throws an error', () => {
		expect(() => enforceLabelRules({
			parentCount: 1,
			labelStr: '',
			title: '',
			parentLabels: [[]],
			parentPrimaryLabels: []
		}).resolvedLabels()).toThrowError('Validation Error: Every proposal must have at least one label.');
	});
});
