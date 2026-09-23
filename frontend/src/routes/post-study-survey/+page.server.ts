import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// Let +layout.server.ts handle auth redirect if needed
	if (!locals.user) {
		return { success: false };
	}
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { error: 'Unauthorized' });

		const data = await request.formData();

		const responses: Record<string, any> = {};

		for (let i = 1; i <= 10; i++) {
			responses[`sus_${i}`] = Number(data.get(`sus_${i}`));
		}

		responses.building_on_ideas = data.get('building_on_ideas');
		responses.convergence_process = data.get('convergence_process');
		responses.finding_quality = data.get('finding_quality');
		responses.fairness_legitimacy = data.get('fairness_legitimacy');
		responses.improvements = data.get('improvements');

		try {
			await locals.pb.collection('post_study_surveys').create({
				user: locals.user.id,
				responses
			});

			return { success: true };
		} catch (err: any) {
			console.error('Failed to submit survey', err);
			return fail(500, { error: 'Failed to submit survey. Please try again later.' });
		}
	}
};
