/**
 * Parse a string environment variable as a boolean.
 * Accepts: '1', 'true', 'yes', 'on' (case-insensitive) as truthy.
 */
export function parseBoolean(value: string | undefined): boolean {
	if (!value) {
		return false;
	}

	const normalized = value.trim().toLowerCase();
	return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}
