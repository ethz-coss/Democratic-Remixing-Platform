/**
 * Tests for feedView.svelte.ts — the shared filter state store.
 *
 * These tests verify the shape and defaults of feedViewState.
 * Since feedViewState is a Svelte 5 $state object (not a reactive store),
 * we test it as a plain object with known defaults.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { feedViewState, getFilterState } from '$lib/feedView.svelte';

describe('feedViewState', () => {
	it('initializes with all filters off', () => {
		const fState = getFilterState('discover');
		expect(fState.onlySupported).toBe(false);
		expect(fState.onlyAuthored).toBe(false);
		expect(fState.onlyInFocus).toBe(false);
		expect(fState.onlyChampions).toBe(false);
		expect(fState.onlyCombinations).toBe(false);
		expect(fState.onlyImprovements).toBe(false);
	});

	it('initializes searchQuery to empty string', () => {
		const fState = getFilterState('discover');
		expect(fState.searchQuery).toBe('');
	});

	it('initializes selectedClusterIdx to null', () => {
		expect(feedViewState.selectedClusterIdx).toBeNull();
	});

	it('initializes championIds as empty Set', () => {
		expect(feedViewState.championIds).toBeInstanceOf(Set);
		expect(feedViewState.championIds.size).toBe(0);
	});

	it('allows setting and reading searchQuery', () => {
		const fState = getFilterState('discover');
		fState.searchQuery = 'climate';
		expect(fState.searchQuery).toBe('climate');
		// cleanup
		fState.searchQuery = '';
	});

	it('allows toggling filter flags', () => {
		const fState = getFilterState('discover');
		fState.onlySupported = true;
		expect(fState.onlySupported).toBe(true);
		fState.onlySupported = false;
		expect(fState.onlySupported).toBe(false);
	});

	it('allows setting selectedClusterIdx and clearing it', () => {
		feedViewState.selectedClusterIdx = 3;
		expect(feedViewState.selectedClusterIdx).toBe(3);
		feedViewState.selectedClusterIdx = null;
		expect(feedViewState.selectedClusterIdx).toBeNull();
	});
});
