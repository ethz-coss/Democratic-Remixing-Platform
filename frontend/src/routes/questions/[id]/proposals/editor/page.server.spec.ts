import { describe, it, expect } from 'vitest';
import { _parseParentIdsFromFormData } from './+page.server';

describe('Editor page server actions', () => {
	describe('_parseParentIdsFromFormData', () => {
		it('deduplicates parent IDs, making it impossible to add a combination with twice the same proposal', () => {
			const formData = new FormData();
			formData.append('parent_ids', 'proposal_1');
			formData.append('parent_ids', 'proposal_1');

			const parentIds = _parseParentIdsFromFormData(formData);

			// A combination requires two distinct parents.
			// Deduplication ensures that [proposal_1, proposal_1] becomes [proposal_1].
			// This causes the creation logic to treat it as a single-parent remix instead of a combination.
			expect(parentIds).toEqual(['proposal_1']);
			expect(parentIds.length).toBe(1);
		});

		it('preserves distinct parent IDs for a valid combination', () => {
			const formData = new FormData();
			formData.append('parent_ids', 'proposal_1');
			formData.append('parent_ids', 'proposal_2');

			const parentIds = _parseParentIdsFromFormData(formData);

			expect(parentIds).toEqual(['proposal_1', 'proposal_2']);
			expect(parentIds.length).toBe(2);
		});

		it('filters out empty values', () => {
			const formData = new FormData();
			formData.append('parent_ids', 'proposal_1');
			formData.append('parent_ids', '');
			formData.append('parent_ids', '  ');

			const parentIds = _parseParentIdsFromFormData(formData);

			expect(parentIds).toEqual(['proposal_1']);
		});
	});
});
