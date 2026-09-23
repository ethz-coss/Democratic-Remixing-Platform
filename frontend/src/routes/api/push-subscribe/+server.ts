import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	return json({
		publicKey: (env.VAPID_PUBLIC_KEY || '').replace(/^"|"$/g, '').replace(/\s+/g, '')
	});
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const { subscription, userAgent } = await request.json();

		if (!subscription || !subscription.endpoint || !subscription.keys) {
			return json({ error: 'Invalid subscription data' }, { status: 400 });
		}

		// Delegate the subscription creation/update to the secure custom PocketBase route
		await locals.pb.send('/api/push_subscribe_custom', {
			method: 'POST',
			body: {
				endpoint: subscription.endpoint,
				p256dh: subscription.keys.p256dh,
				auth: subscription.keys.auth,
				user_agent: userAgent || ''
			}
		});

		return json({ success: true });
	} catch (error) {
		console.error('Failed to save push subscription:', error);
		return json({ error: 'Failed to save subscription' }, { status: 500 });
	}
};
