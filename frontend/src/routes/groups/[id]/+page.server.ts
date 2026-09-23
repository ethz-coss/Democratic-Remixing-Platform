import { requireUserOrRedirect } from '$lib/server/pb.server';
import { normalizeQuestionRecord } from '$lib/server/questions';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const user = requireUserOrRedirect(locals, `/login?redirect=/groups/${params.id}`);

	const isGlobalAdmin = user.role === 'admin';

	try {
		const group = await locals.pb.collection('groups').getOne(params.id);

		// Fetch all members of this group

		const members = await locals.pb.collection('group_members').getFullList({
			filter: `group="${group.id}"`,
			expand: 'user',
			sort: '-created'
		});

		// Fetch questions associated with this group
		const questions = await locals.pb.collection('questions').getFullList({
			filter: `group="${group.id}"`,
			sort: '-created',
			expand: 'current_phase'
		});

		const isGroupAdmin = members.some((m) => m.user === user.id && m.role === 'Admin');
		const canCreateQuestion = isGlobalAdmin || isGroupAdmin;

		return {
			group,
			isGlobalAdmin,
			canCreateQuestion,
			members: members.map((m) => ({
				id: m.id,
				user: m.expand?.user,
				role: m.role,
				created: m.created
			})),
			questions: questions.map(normalizeQuestionRecord)
		};
	} catch (err) {
		console.error('Error loading group:', err);
		throw error(404, 'Group not found or you do not have access.');
	}
};
