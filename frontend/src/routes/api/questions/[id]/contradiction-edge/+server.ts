import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { escapeFilter } from '$lib/server/questions';

/**
 * POST /api/questions/[id]/contradiction-edge
 *
 * Creates a contradiction edge between two ideas for the authenticated user.
 * Body: { idea_a: string, idea_b: string, reason: string }
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user || !locals.pb) {
		throw error(401, 'Authentication required');
	}

	const questionId = params.id;
	const body = await request.json();

	const { idea_a, idea_b, reason } = body as {
		idea_a?: string;
		idea_b?: string;
		reason?: string;
	};

	if (!idea_a || !idea_b) {
		throw error(400, 'idea_a and idea_b are required');
	}

	if (!reason?.trim()) {
		throw error(400, 'A reason is required');
	}

	try {
		// Proxy to the custom PocketBase endpoint which handles divergent vote validation
		const result = await locals.pb.send(`/api/questions/${questionId}/contradiction-edge`, {
			method: 'POST',
			body: { idea_a, idea_b, reason: reason.trim() }
		});

		return json(result, { status: 200 });
	} catch (err: any) {
		console.error('[contradiction-edge] Failed to proxy', err.response || err);
		return json(
			{ message: err.response?.message || err.message || 'Failed to create contradiction edge' },
			{ status: err.status && err.status >= 400 ? err.status : 400 }
		);
	}
};
