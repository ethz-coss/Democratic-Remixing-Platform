import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	let votingSummary: App.VotingSummary | undefined;
	try {
		votingSummary = await locals.pb.send('/api/custom/voting-results', {
			query: { question: params.id }
		});
	} catch (e) {
		// Ignore — UI degrades gracefully
	}

	return {
		votingSummary
	};
};
