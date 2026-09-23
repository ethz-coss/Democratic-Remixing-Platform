import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { EventSource } from 'eventsource';

// Ensure EventSource is globally available for PocketBase JS SDK in Node
if (typeof global !== 'undefined' && !global.EventSource) {
	global.EventSource = EventSource as any;
}

export const GET: RequestHandler = ({ locals, request }) => {
	if (!locals.user) {
		throw error(401, 'Unauthorized');
	}

	const pb = locals.pb;
	const userId = locals.user.id;

	const stream = new ReadableStream({
		async start(controller) {
			try {
				// Send an initial ping to ensure the headers are flushed and the connection is established immediately.
				// This prevents Vite preview/proxies from buffering indefinitely.
				controller.enqueue(new TextEncoder().encode(': ping\n\n'));

				await pb.collection('push_notification_log').subscribe('*', (e) => {
					// Filter events for this user (just as an extra safety measure, though PB rules should handle it)
					if (e.record.user !== userId) return;

					const eventData = `data: ${JSON.stringify(e)}\n\n`;
					controller.enqueue(new TextEncoder().encode(eventData));
				});
			} catch (e) {
				console.error('[SSE] Failed to subscribe to push logs', e);
				controller.error(e);
			}
		},
		cancel() {
			pb.collection('push_notification_log').unsubscribe('*').catch(console.error);
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive'
		}
	});
};
