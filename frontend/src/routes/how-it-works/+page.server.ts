import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
	completeOnboarding: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(303, '/login');
		}

		try {
			const updatedUser = await locals.pb.collection('users').update(locals.user.id, {
				has_seen_onboarding: true
			});
			locals.pb.authStore.save(locals.pb.authStore.token, updatedUser);
		} catch (err) {
			console.error('Failed to update onboarding status', err);
		}

		// Find an AnswerSearch question first
		let targetQuestionId = null;
		try {
			const activeQuestion = await locals.pb
				.collection('questions')
				.getFirstListItem('visibility="Public" && current_phase_name="AnswerSearch"', {
					sort: '-created'
				});
			targetQuestionId = activeQuestion.id;
		} catch (err) {
			// Ignore, try fallback
		}

		if (!targetQuestionId) {
			try {
				const fallbackQuestion = await locals.pb
					.collection('questions')
					.getFirstListItem('visibility="Public"', {
						sort: '-created'
					});
				targetQuestionId = fallbackQuestion.id;
			} catch (err) {
				// No questions found
			}
		}

		if (targetQuestionId) {
			throw redirect(303, `/questions/${targetQuestionId}?tutorial=phase`);
		} else {
			throw redirect(303, '/discourse');
		}
	}
};
