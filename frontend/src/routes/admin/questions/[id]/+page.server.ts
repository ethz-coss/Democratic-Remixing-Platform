import { requireUserOrRedirect, createAdminPocketBase } from '$lib/server/pb.server';
import { normalizeQuestionRecord } from '$lib/server/questions';
import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const user = requireUserOrRedirect(locals, `/login?redirect=/admin/questions/${params.id}`);

	if (user.role !== 'admin') {
		throw error(403, 'Admin access required.');
	}

	try {
		const questionRecord = await locals.pb.collection('questions').getOne(params.id, {
			expand: 'current_phase'
		});
		const question = normalizeQuestionRecord(questionRecord);

		return {
			question,
			user
		};
	} catch (err: any) {
		if (err.status === 404) {
			throw error(404, 'Question not found.');
		}
		throw error(500, 'Internal Server Error');
	}
};

export const actions: Actions = {
	forcePhaseTransition: async ({ request, locals, params }) => {
		if (!locals.user || locals.user.role !== 'admin') {
			return fail(403, { message: 'Admin only' });
		}

		const formData = await request.formData();
		const questionId = String(formData.get('questionId') ?? params.id).trim();
		const nextPhase = formData.get('nextPhase')?.toString();

		if (questionId !== params.id) {
			return fail(400, { message: 'Question id mismatch.' });
		}
		if (!nextPhase) {
			return fail(400, { message: 'Missing nextPhase' });
		}

		const adminPb = await createAdminPocketBase();

		try {
			// Find the current active phase record for this question
			const openPhases = await adminPb.collection('question_phases').getList(1, 1, {
				filter: `question="${questionId}" && ended_at=""`,
				sort: '-started_at'
			});

			const previousPhase = openPhases.items.length > 0 ? openPhases.items[0] : null;

			// If it's already in the target phase, do nothing
			if (previousPhase && previousPhase.phase_name === nextPhase) {
				return { ok: true, noop: true };
			}

			// Close the previous phase
			if (previousPhase) {
				await adminPb.collection('question_phases').update(previousPhase.id, {
					ended_at: new Date().toISOString()
				});
			}

			// Create the new phase
			const newPhase = await adminPb.collection('question_phases').create({
				question: questionId,
				phase_name: nextPhase,
				started_at: new Date().toISOString(),
				ended_at: '',
				previous_phase: previousPhase?.id || null,
				transition_type: 'forced_by_admin'
			});

			// Update the question itself
			await adminPb.collection('questions').update(questionId, {
				current_phase: newPhase.id,
				current_phase_name: nextPhase,
				status: nextPhase,
				__is_transition: true
			});
		} catch (err: any) {
			console.error('Failed to force phase transition:', err);
			return fail(500, { message: 'Failed to transition phase' });
		}

		return { ok: true };
	}
};
