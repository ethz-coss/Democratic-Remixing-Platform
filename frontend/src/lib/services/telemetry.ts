export async function logAction(
	action_type: string,
	data: { question?: string; target_id?: string; metadata?: any } = {}
) {
	try {
		await fetch('/api/action-logs', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				action_type,
				question: data.question || null,
				target_id: data.target_id || null,
				metadata_json: data.metadata || null,
				occurred_at: new Date().toISOString()
			})
		});
	} catch (err) {
		// Suppress telemetry errors to avoid interrupting user flow
		console.warn('Telemetry failed', err);
	}
}
