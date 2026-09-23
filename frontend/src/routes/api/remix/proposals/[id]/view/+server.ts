import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * POST /api/remix/proposals/[id]/view
 *
 * Tracks a user view for a proposal.
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.pb) {
		throw error(401, 'Authentication required');
	}

	const proposalId = params.id;

	try {
		// Proxy to the custom PocketBase endpoint which handles view tracking
		const result = await locals.pb.send(`/api/remix/proposals/${proposalId}/view`, {
			method: 'POST',
			body: { userId: locals.user.id },
			headers: { 'Content-Type': 'application/json' }
		});

		return json(result, { status: 200 });
	} catch (err: any) {
		console.error('[proposal-view] Failed to proxy', err.response || err);
		return json(
			{ message: err.response?.message || err.message || 'Failed to track proposal view' },
			{ status: err.status && err.status >= 400 ? err.status : 400 }
		);
	}
};
