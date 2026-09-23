import { describe, it, expect, vi } from 'vitest';
import { filterDagProposals } from './dag-interaction.svelte';
import { editorState } from '$lib/editor.svelte';

vi.mock('$lib/editor.svelte', () => ({
	editorState: {
		isOpen: false,
		phase: 'root',
		parentA: null,
		parentB: null,
		comparePool: []
	}
}));

// Mock feedViewState as it is used globally in the function
vi.mock('$lib/feedView.svelte', () => ({
	feedViewState: {
		onlySupported: false,
		onlyAuthored: false,
		onlyInFocus: false,
		onlyChampions: false,
		onlyCombinations: false,
		onlyImprovements: false,
		onlyUnseen: false,
		selectedClusterIdx: null,
		searchQuery: ''
	}
}));

// Mock goto and page from $app navigation/state
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost') } }));

describe('filterDagProposals', () => {
	it('returns lineage nodes in proposal detail view', () => {
		const targetId = 'a8gc5u973t1ibry';

		const allSols = [
			{ id: 'a8gc5u973t1ibry', parent_proposals: [] },
			{ id: '42tvsrrra48tqcq', parent_proposals: [] },
			{ id: 'ran2zt37oogc8dd', parent_proposals: ['a8gc5u973t1ibry', '42tvsrrra48tqcq'] },
			{ id: 'unrelated', parent_proposals: [] }
		] as unknown as App.ProposalRecord[];

		const filtered = filterDagProposals(allSols, 'proposal', targetId, {});
		const filteredIds = filtered.map((s) => s.id);

		expect(filteredIds).toContain('a8gc5u973t1ibry');
		expect(filteredIds).toContain('ran2zt37oogc8dd');
		expect(filteredIds).toContain('42tvsrrra48tqcq'); // other parent of the descendant
		expect(filteredIds).not.toContain('unrelated');
		expect(filteredIds).toHaveLength(3);
	});

	it('returns only theme cluster and immediate parents when activeThemeKey is provided', () => {
		const allSols = [
			{ id: 't1', primary_label: 'theme1', parent_proposals: ['root1'] },
			{ id: 'root1', primary_label: 'theme_other', parent_proposals: [] },
			{ id: 'unrelated', primary_label: 'theme_other', parent_proposals: [] }
		] as unknown as App.ProposalRecord[];

		const filtered = filterDagProposals(allSols, 'themes', null, {}, null, new Set(), [], 'theme1');
		const filteredIds = filtered.map((s) => s.id);

		expect(filteredIds).toContain('t1');
		expect(filteredIds).toContain('root1');
		expect(filteredIds).not.toContain('unrelated');
		expect(filteredIds).toHaveLength(2);
	});
});
