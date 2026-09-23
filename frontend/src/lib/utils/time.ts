function parseDate(iso: string | undefined | null): Date | null {
	if (!iso) return null;
	const normalized = iso.replace(' ', 'T');
	const d = new Date(normalized);
	return isNaN(d.getTime()) ? null : d;
}

export function formatTimeRemaining(endIso: string | undefined | null, currentNow: number): string {
	if (!endIso) return 'Pending...';
	const endMs = parseDate(endIso)?.getTime();
	if (!endMs) return 'Pending...';

	const remaining = endMs - currentNow;
	if (remaining <= 0) return '00:00:00 (Ended)';

	const totalHours = Math.floor(remaining / 3600000);
	const totalDays = Math.floor(totalHours / 24);

	const hStr = totalHours.toString().padStart(2, '0');
	const dStr = totalDays.toString();
	const remainingHoursStr = (totalHours % 24).toString().padStart(2, '0');

	const m = Math.floor((remaining % 3600000) / 60000)
		.toString()
		.padStart(2, '0');
	const s = Math.floor((remaining % 60000) / 1000)
		.toString()
		.padStart(2, '0');

	if (totalDays > 0) {
		return `${dStr}d ${remainingHoursStr}h`;
	}
	if (totalHours > 0) {
		return `${hStr}h ${m}m`;
	}
	return `${m}m ${s}s`;
}

export function getRemainingPercentage(
	startIso: string | undefined | null,
	endIso: string | undefined | null,
	currentNow: number
): number {
	if (!endIso || !startIso) return 0;

	const endMs = parseDate(endIso)?.getTime();
	const startMs = parseDate(startIso)?.getTime();

	if (!endMs || !startMs) return 0;

	const durationMs = endMs - startMs;
	if (durationMs <= 0) return 0;

	const elapsed = currentNow - startMs;
	return Math.max(0, Math.min(100, (elapsed / durationMs) * 100));
}

export function formatSwissDate(dateInput: Date | string | undefined | null): string {
	if (!dateInput) return '';

	const d = typeof dateInput === 'string' ? parseDate(dateInput) : dateInput;
	if (!d || isNaN(d.getTime())) return '';

	return new Intl.DateTimeFormat('de-CH', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric'
	}).format(d);
}
