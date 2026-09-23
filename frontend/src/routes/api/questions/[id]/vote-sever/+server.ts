import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * POST /api/questions/[id]/vote-sever
 *
 * Casts a democratic agree/disagree vote on a contradiction edge.
 * Body: { edge_id: string, vote: 'agree' | 'disagree' }
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user || !locals.pb) {
		throw error(401, 'Authentication required');
	}

	const questionId = params.id;
	const body = await request.json();

	const { edge_id, vote } = body as {
		edge_id?: string;
		vote?: 'agree' | 'disagree';
	};

	if (!edge_id) {
		throw error(400, 'edge_id is required');
	}

	if (vote !== 'agree' && vote !== 'disagree') {
		throw error(400, 'vote must be "agree" or "disagree"');
	}

	try {
		const result = await locals.pb.send(`/api/questions/${questionId}/vote-sever`, {
			method: 'POST',
			body: { edge_id, vote }
		});

		return json(result, { status: 200 });
	} catch (err: any) {
		console.error('[vote-sever] Failed to proxy', err.response || err);
		return json(
			{ message: err.response?.message || err.message || 'Failed to vote on sever' },
			{ status: err.status && err.status >= 400 ? err.status : 400 }
		);
	}
};
