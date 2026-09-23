import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import webPush from 'web-push';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { secret, subscriptions, payload, messages } = await request.json();

		if (secret !== env.PUSH_SECRET) {
			console.error(`[push-send] Unauthorized: secret mismatch`);
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		if (
			!messages &&
			(!subscriptions || !Array.isArray(subscriptions) || subscriptions.length === 0)
		) {
			return json({ success: true, message: 'No subscriptions provided' });
		}

		if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
			console.error('[push-send] VAPID keys are not configured');
			return json({ error: 'Push not configured' }, { status: 500 });
		}

		const subject = (env.VAPID_SUBJECT || '').replace(/^"|"$/g, '');
		const publicKey = (env.VAPID_PUBLIC_KEY || '').replace(/^"|"$/g, '').replace(/\s+/g, '');
		const privateKey = (env.VAPID_PRIVATE_KEY || '').replace(/^"|"$/g, '').replace(/\s+/g, '');

		webPush.setVapidDetails(subject, publicKey, privateKey);
		console.log(`[push-send] Using VAPID subject: ${subject}`);

		const allPromises: Promise<any>[] = [];

		if (messages && Array.isArray(messages)) {
			for (const msg of messages) {
				if (!msg.subscriptions || !msg.payload) continue;
				const pushPayload = JSON.stringify(msg.payload);
				const subs = msg.subscriptions;
				// Cap at 20 per user — more than that signals stale test data.
				// 410 responses from FCM/APNs will trigger cleanup via deleteStaleSubscriptions.
				if (subs.length > 20) {
					console.warn(
						`[push-send] User has ${subs.length} subscriptions — capping at 20. Stale subs will be pruned on 410.`
					);
				}
				for (const sub of subs.slice(0, 20)) {
					const pushSubscription = {
						endpoint: sub.endpoint,
						keys: { p256dh: sub.p256dh, auth: sub.auth }
					};
					allPromises.push(
						webPush
							.sendNotification(pushSubscription, pushPayload, { urgency: 'normal' })
							.then(() => {
								console.log(
									`[push-send] ✓ Delivered to ${sub.endpoint.substring(0, 60)}... (id: ${sub.id})`
								);
								return { success: true, id: sub.id };
							})
							.catch((err: any) => {
								console.warn(
									`[push-send] ✗ Failed ${sub.endpoint.substring(0, 60)}... status=${err.statusCode} body=${err.body} (id: ${sub.id})`
								);
								return {
									failed: true,
									endpoint: sub.endpoint,
									id: sub.id,
									statusCode: err.statusCode
								};
							})
					);
				}
			}
		} else if (subscriptions && payload) {
			// Legacy single-user path
			const pushPayload = JSON.stringify(payload);
			for (const sub of subscriptions) {
				const pushSubscription = {
					endpoint: sub.endpoint,
					keys: { p256dh: sub.p256dh, auth: sub.auth }
				};
				allPromises.push(
					webPush
						.sendNotification(pushSubscription, pushPayload)
						.then(() => {
							console.log(
								`[push-send] ✓ Delivered to ${sub.endpoint.substring(0, 60)}... (id: ${sub.id})`
							);
							return { success: true, id: sub.id };
						})
						.catch((err: any) => {
							console.warn(
								`[push-send] ✗ Failed ${sub.endpoint.substring(0, 60)}... status=${err.statusCode} body=${err.body} (id: ${sub.id})`
							);
							return {
								failed: true,
								endpoint: sub.endpoint,
								id: sub.id,
								statusCode: err.statusCode
							};
						})
				);
			}
		}

		const results = await Promise.all(allPromises);
		const failures = results.filter((r) => r && 'failed' in r && (r as any).failed);

		if (failures.length > 0) {
			console.warn(`[push-send] ${failures.length}/${results.length} deliveries failed`, failures);
		} else {
			console.log(`[push-send] All ${results.length} notification(s) delivered`);
		}

		return json({ success: true, failures });
	} catch (error) {
		console.error('[push-send] Internal error:', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
