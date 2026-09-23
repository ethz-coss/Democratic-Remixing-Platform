import { describe, expect, it } from 'vitest';
import { enforceLabelRules } from './label-rules.js';

describe('Label Creation Rules', () => {
	it('root idea (0 parents): must create a label', () => {
		const res = enforceLabelRules({
			parentCount: 0,
			labelStr: 'Economy',
			title: 'Universal Basic Income',
			parentLabels: [],
			parentPrimaryLabels: []
		});
		
		expect(res.shouldCreateLabel).toBe(true);
		expect(res.newLabelShortName).toBe('Economy');
		expect(res.resolvedLabels('new1')).toEqual(['new1']);
		expect(res.resolvedPrimaryLabel('new1')).toBe('new1');
	});

	it('root idea with empty label: auto-generates from title', () => {
		const res = enforceLabelRules({
			parentCount: 0,
			labelStr: '  ',
			title: 'A very long title that should be truncated to 40 characters if necessary',
			parentLabels: [],
			parentPrimaryLabels: []
		});
		
		expect(res.shouldCreateLabel).toBe(true);
		expect(res.newLabelShortName).toBe('A very long title that should be truncat'); // first 40 chars
	});

	it('single-parent remix: includes new label and inherits parent labels', () => {
		const res = enforceLabelRules({
			parentCount: 1,
			labelStr: 'New Label',
			title: 'Some title',
			parentLabels: [['L1']],
			parentPrimaryLabels: ['L1']
		});
		
		expect(res.shouldCreateLabel).toBe(true);
		expect(res.newLabelShortName).toBe('New Label');
		expect(res.resolvedLabels('L2')).toEqual(['L1', 'L2']);
		expect(res.resolvedPrimaryLabel('L2')).toBe('L2');
	});

	it('single-parent remix: inherits all parent labels', () => {
		const res = enforceLabelRules({
			parentCount: 1,
			labelStr: '',
			title: '',
			parentLabels: [['L1', 'L2']],
			parentPrimaryLabels: ['L1']
		});
		
		expect(res.shouldCreateLabel).toBe(false);
		expect(res.resolvedLabels()).toEqual(['L1', 'L2']);
		expect(res.resolvedPrimaryLabel()).toBe('L1');
	});

	it('multi-parent remix: inherits union of parent labels', () => {
		const res = enforceLabelRules({
			parentCount: 2,
			labelStr: '',
			title: '',
			parentLabels: [['L1'], ['L2']],
			parentPrimaryLabels: ['L1', 'L2']
		});
		
		expect(res.shouldCreateLabel).toBe(false);
		expect(res.resolvedLabels()).toEqual(['L1', 'L2']);
		expect(res.resolvedPrimaryLabel()).toBe('L1'); // defaults to first parent
	});

	it('multi-parent remix with new label: creates and includes new label', () => {
		const res = enforceLabelRules({
			parentCount: 2,
			labelStr: 'Green Economy',
			title: '',
			parentLabels: [['L1'], ['L2']],
			parentPrimaryLabels: ['L1', 'L2']
		});
		
		expect(res.shouldCreateLabel).toBe(true);
		expect(res.newLabelShortName).toBe('Green Economy');
		expect(res.resolvedLabels('L3')).toEqual(['L1', 'L2', 'L3']);
		expect(res.resolvedPrimaryLabel('L3')).toBe('L3'); // defaults to new label
	});

	it('multi-parent remix: primary_label defaults to new label if created', () => {
		const res = enforceLabelRules({
			parentCount: 2,
			labelStr: 'Synthesis',
			title: '',
			parentLabels: [],
			parentPrimaryLabels: []
		});
		
		expect(res.resolvedPrimaryLabel('L_NEW')).toBe('L_NEW');
	});

	it('multi-parent remix: primary_label defaults to first parent primary_label if no new label', () => {
		const res = enforceLabelRules({
			parentCount: 2,
			labelStr: '',
			title: '',
			parentLabels: [],
			parentPrimaryLabels: ['L_FIRST']
		});
		
		expect(res.resolvedPrimaryLabel()).toBe('L_FIRST');
	});
});
