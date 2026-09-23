/**
 * Canonical relation normalization helpers.
 *
 * PocketBase relation fields may be returned as a plain string ID, an array
 * of strings, an object with an `id` property, or an array of such objects.
 * These helpers collapse every variant into a consistent shape.
 */

/**
 * Extract a single relation ID from a PocketBase relation field value.
 * Handles: string, string[], object with `.id`, array of objects.
 */
export function normalizeSingleRelation(value: unknown): string {
	if (Array.isArray(value)) {
		const first = value[0];
		if (typeof first === 'string') return first;
		if (first && typeof first === 'object') return String((first as { id?: unknown }).id ?? '');
		return '';
	}
	if (typeof value === 'string') return value;
	if (value && typeof value === 'object') return String((value as { id?: unknown }).id ?? '');
	return '';
}

/**
 * Extract an array of relation IDs from a PocketBase multi-relation field.
 */
export function normalizeRelationIds(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value
			.map((item) => {
				if (typeof item === 'string') return item.trim();
				if (item && typeof item === 'object')
					return String((item as { id?: unknown }).id ?? '').trim();
				return '';
			})
			.filter(Boolean);
	}

	if (typeof value === 'string' && value.trim() !== '') {
		return [value.trim()];
	}

	return [];
}
