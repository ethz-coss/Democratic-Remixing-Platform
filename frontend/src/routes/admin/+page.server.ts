import { requireUserOrRedirect } from '$lib/server/pb.server';
import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ locals, fetch }) => {
	const user = requireUserOrRedirect(locals, '/login?redirect=/admin');

	if (user.role !== 'admin') {
		throw error(403, 'Only administrators can access this page.');
	}

	// Fetch all groups via standard client (rules now allow admins)
	const allGroups = await locals.pb.collection('groups').getFullList({
		sort: '-created',
		expand: 'author'
	});
	// Get member counts for each group
	const groupsWithCounts = await Promise.all(
		allGroups.map(async (group) => {
			const members = await locals.pb
				.collection('group_members')
				.getFullList({
					filter: `group="${group.id}"`,
					fields: 'id'
				})
				.catch(() => []);
			return {
				id: group.id,
				name: group.name,
				description: group.description || '',
				invite_token: group.invite_token,
				created: group.created,
				authorName: group.expand?.author?.name || group.expand?.author?.username || 'Unknown',
				memberCount: members.length
			};
		})
	);

	// Fetch all questions for the admin dashboard
	const allQuestions = await locals.pb.collection('questions').getFullList({
		sort: '-created',
		expand: 'author,current_phase,group'
	});

	const questionsList = allQuestions.map((p) => ({
		id: p.id,
		title: p.title,
		current_phase_name: p.expand?.current_phase?.phase_name || p.current_phase_name || 'Proposed',
		authorName: p.expand?.author?.name || p.expand?.author?.username || 'Unknown',
		groupName: p.expand?.group?.name || null,
		created: p.created
	}));

	return {
		groups: groupsWithCounts,
		questions: questionsList
	};
};
