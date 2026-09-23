/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener('install', () => {
	// Activate the new service worker immediately without waiting for old tabs to close
	sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
	// Take control of all open clients immediately after activation
	event.waitUntil(sw.clients.claim());
});

sw.addEventListener('push', (event) => {
	let data: any = {};
	try {
		if (event.data) {
			try {
				data = event.data.json();
			} catch (e) {
				console.warn('Push data is not JSON, falling back to text');
				data = { title: 'New Notification', body: event.data.text() };
			}
		}
		const title = data.title || 'New Notification';
		const options: NotificationOptions = {
			body: data.body || '',
			icon: '/web-app-manifest-192x192.png',
			badge: '/favicon-96x96.png',
			tag: data.data?.logId || 'push-default',
			data: data.data || {}
			// NO actions array — unsupported on iOS, causes silent TypeError
		};

		// Badge API (supported on iOS PWA)
		let badgePromise = Promise.resolve();
		try {
			if ('setAppBadge' in navigator) {
				badgePromise = (navigator as any).setAppBadge(1).catch(() => {});
			}
		} catch (e) {
			console.warn('Failed to set badge', e);
		}

		// MUST always show a notification — iOS revokes subscriptions after silent push failures
		let notificationPromise;
		try {
			notificationPromise = sw.registration.showNotification(title, options).catch(() => {
				// Fallback: show minimal notification without any optional fields
				return sw.registration.showNotification(title, { body: data.body || '' });
			});
		} catch (err) {
			notificationPromise = sw.registration.showNotification(title, { body: data.body || '' });
		}

		event.waitUntil(Promise.all([notificationPromise, badgePromise]));
	} catch (fatalErr) {
		console.error('Fatal error in push handler:', fatalErr);
		event.waitUntil(
			sw.registration.showNotification('New Notification', { body: 'You have a new update.' })
		);
	}
});

sw.addEventListener('notificationclick', (event) => {
	event.notification.close();

	if ('clearAppBadge' in navigator) {
		(navigator as any).clearAppBadge().catch(() => {});
	}

	if (event.action === 'dismiss') {
		const logId = event.notification.data?.logId;
		if (logId) {
			event.waitUntil(
				fetch('/api/push-action', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ id: logId, status: 'dismissed', source: 'push' })
				})
			);
		}
		return;
	}

	const logId = event.notification.data?.logId;
	const actionPromise = logId
		? fetch('/api/push-action', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: logId, status: 'actioned', source: 'push' })
			}).catch((err) => console.error('Failed to log push action', err))
		: Promise.resolve();

	// Get the URL from notification data or fallback to /discourse
	const urlToOpen = event.notification.data?.url || '/discourse';
	const targetPathname = new URL(urlToOpen, self.location.origin).pathname;

	const windowPromise = sw.clients
		.matchAll({
			type: 'window',
			includeUncontrolled: true
		})
		.then((windowClients) => {
			// Check if there is already a window/tab open with the target URL
			for (let i = 0; i < windowClients.length; i++) {
				const client = windowClients[i];
				const clientPathname = new URL(client.url, self.location.origin).pathname;
				if (clientPathname === targetPathname && 'focus' in client) {
					if ('navigate' in client) {
						(client as WindowClient).navigate(urlToOpen);
					}
					return client.focus();
				}
			}
			// If not, then open the target URL in a new window/tab.
			if (sw.clients.openWindow) {
				return sw.clients.openWindow(urlToOpen);
			}
		});

	event.waitUntil(Promise.all([actionPromise, windowPromise]));
});
