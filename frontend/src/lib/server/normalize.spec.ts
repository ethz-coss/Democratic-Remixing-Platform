import { describe, expect, it } from 'vitest';
import { normalizeRelationIds } from './normalize.js';

describe('normalizeRelationIds', () => {
	it('handles string input (single-value multi-relation)', () => {
		expect(normalizeRelationIds('abc123')).toEqual(['abc123']);
	});

	it('handles array of strings', () => {
		expect(normalizeRelationIds(['abc', 'def'])).toEqual(['abc', 'def']);
	});

	it('handles empty string', () => {
		expect(normalizeRelationIds('')).toEqual([]);
	});

	it('handles null/undefined', () => {
		expect(normalizeRelationIds(null)).toEqual([]);
		expect(normalizeRelationIds(undefined)).toEqual([]);
	});

	it('handles array of objects with id', () => {
		expect(normalizeRelationIds([{ id: 'abc' }, { id: 'def' }])).toEqual(['abc', 'def']);
	});

	it('trims whitespace', () => {
		expect(normalizeRelationIds(['  abc  ', ' def'])).toEqual(['abc', 'def']);
	});

	it('filters empty strings from array', () => {
		expect(normalizeRelationIds(['abc', '', 'def'])).toEqual(['abc', 'def']);
	});
});
