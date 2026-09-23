import PocketBase from 'pocketbase';
import { PUBLIC_API_DEBUG_LOGS, PUBLIC_API_DEBUG_LOGS_BODY, PUBLIC_POCKETBASE_URL } from '$lib/env';
import { configurePocketBaseDebug } from '$lib/debug/pocketbase';

export function createPocketBase() {
	const pb = new PocketBase(PUBLIC_POCKETBASE_URL);
	configurePocketBaseDebug(pb, {
		enabled: PUBLIC_API_DEBUG_LOGS,
		includeBody: PUBLIC_API_DEBUG_LOGS_BODY,
		context: 'browser'
	});
	return pb;
}
