import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.pb.authStore.isValid || !locals.user) {
		return json({ success: false, message: 'Unauthorized' }, { status: 401 });
	}

	try {
		const body = await request.json();
		const { id, status, source = 'push' } = body;

		if (!id || !status) {
			return json({ success: false, message: 'Missing parameters' }, { status: 400 });
		}

		if (status !== 'actioned' && status !== 'dismissed') {
			return json({ success: false, message: 'Invalid status' }, { status: 400 });
		}

		// Fetch the push notification log to get metadata
		const pushLog = await locals.pb.collection('push_notification_log').getOne(id);
		let payload = pushLog.payload_json;
		if (typeof payload === 'string') {
			try {
				payload = JSON.parse(payload);
			} catch (e) {}
		}
		payload = payload || {};

		// We can just update the record, PocketBase API rules ensure we only update our own records.
		await locals.pb.collection('push_notification_log').update(id, {
			status: status
		});

		// Determine action_type
		let action_type = '';
		if (source === 'panel') {
			action_type =
				status === 'actioned' ? 'notification_panel_click' : 'notification_panel_dismiss';
		} else {
			action_type = status === 'actioned' ? 'push_notification_click' : 'push_notification_dismiss';
		}

		// Create action_log for telemetry
		await locals.pb.collection('action_logs').create({
			user: locals.user.id,
			action_type: action_type,
			target_id: id,
			metadata_json: {
				event_type: pushLog.event_type,
				url: payload.data?.url || payload.url || null,
				title: payload.title || null
			},
			occurred_at: new Date().toISOString()
		});

		return json({ success: true });
	} catch (err: any) {
		console.error('Error in /api/push-action:', err);
		return json(
			{ success: false, message: err.message || 'Internal Server Error' },
			{ status: 500 }
		);
	}
};
