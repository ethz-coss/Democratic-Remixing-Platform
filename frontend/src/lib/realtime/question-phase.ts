import type PocketBase from 'pocketbase';
import { createPocketBase } from '$lib/pb';

type RealtimeCollection =
	| 'questions'
	| 'proposals'
	| 'proposal_votes'
	| 'labels'
	| 'proposal_hides';

type RealtimeEvent = {
	action?: string;
	record?: Record<string, unknown>;
};

type RealtimeOptions = {
	questionIds?: string[];
	collections?: RealtimeCollection[];
	debounceMs?: number;
	pb?: PocketBase;
	onRefresh: () => void;
};

function extractQuestionId(collectionName: RealtimeCollection, event: RealtimeEvent): string {
	// proposal_hides has no question field — always accept its events since
	// the layout server filters by user, not question.
	if (collectionName === 'proposal_hides') return '__always_accept__';

	const record = event && typeof event === 'object' ? event.record : null;
	if (!record || typeof record !== 'object') {
		return '';
	}

	if (collectionName === 'questions') {
		return String(record.id || '').trim();
	}

	const recordQuestionId = record.question;
	if (recordQuestionId) {
		return Array.isArray(recordQuestionId)
			? String(recordQuestionId[0] || '')
			: String(recordQuestionId || '');
	}

	return '';
}

export async function startQuestionRealtimeSync(options: RealtimeOptions): Promise<() => void> {
	const pb = options.pb || createPocketBase();
	const collections: RealtimeCollection[] =
		options.collections && options.collections.length > 0
			? options.collections
			: ['questions', 'proposals', 'proposal_votes'];
	const debounceMs = Number.isFinite(Number(options.debounceMs))
		? Math.max(0, Math.round(Number(options.debounceMs)))
		: 120;
	const trackedQuestions = new Set(
		(options.questionIds || []).map((id) => String(id || '').trim()).filter(Boolean)
	);

	let stopped = false;
	let pendingTimer: ReturnType<typeof setTimeout> | null = null;
	const unsubscribers: Array<() => void> = [];

	const triggerRefresh = () => {
		if (stopped) {
			return;
		}

		if (pendingTimer) {
			return;
		}

		pendingTimer = setTimeout(() => {
			pendingTimer = null;
			if (!stopped) {
				options.onRefresh();
			}
		}, debounceMs);
	};

	await Promise.all(
		collections.map(async (collectionName) => {
			const unsubscribe = await pb
				.collection(collectionName)
				.subscribe('*', (event: RealtimeEvent) => {
					const action = String((event && event.action) || '').trim();
					if (!action || action === 'delete') {
						return;
					}

					const eventQuestionId = extractQuestionId(collectionName, event);
					const shouldAccept =
						trackedQuestions.size === 0 ||
						eventQuestionId === '__always_accept__' ||
						(eventQuestionId !== '' && trackedQuestions.has(eventQuestionId));

					if (!shouldAccept) {
						return;
					}

					triggerRefresh();
				});

			if (stopped) {
				unsubscribe();
				return;
			}

			unsubscribers.push(unsubscribe);
		})
	);

	return () => {
		stopped = true;
		if (pendingTimer) {
			clearTimeout(pendingTimer);
			pendingTimer = null;
		}

		unsubscribers.forEach((unsubscribe) => {
			try {
				unsubscribe();
			} catch {
				// Ignore realtime teardown errors when navigating.
			}
		});
	};
}
