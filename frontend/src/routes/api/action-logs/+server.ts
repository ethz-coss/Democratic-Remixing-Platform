import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.pb.authStore.model;
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const body = await request.json();
		const { question, action_type, target_id, metadata_json, occurred_at } = body;

		if (!action_type) {
			return json({ error: 'Missing required field action_type' }, { status: 400 });
		}

		const payload: Record<string, any> = {
			user: user.id,
			action_type,
			occurred_at: occurred_at || new Date().toISOString()
		};

		if (question) payload.question = question;
		if (target_id) payload.target_id = target_id;
		if (metadata_json) payload.metadata_json = metadata_json;

		const record = await locals.pb.collection('action_logs').create(payload);

		return json({ success: true, record });
	} catch (err: any) {
		if (err?.status === 400 || err?.status === 404) {
			console.warn(
				'[api/action-logs] failed to log action (invalid reference or target):',
				err.message,
				err.response?.data
			);
			return json({ error: 'Invalid reference for action log' }, { status: 400 });
		}
		console.error('[api/action-logs] failed to log action', err);
		return json({ error: 'Failed to log action' }, { status: 500 });
	}
};
