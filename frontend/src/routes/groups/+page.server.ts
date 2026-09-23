import { requireUserOrRedirect } from '$lib/server/pb.server';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireUserOrRedirect(locals, '/login?redirect=/groups');

	// Fetch groups directly. The PocketBase listRule will naturally filter this down
	// to only the groups where the user is a member or author.
	const groups = await locals.pb.collection('groups').getFullList({
		sort: '-created'
	});

	// Fetch counts for each group
	const groupCounts: Record<string, { members: number; questions: number }> = {};
	if (groups.length > 0) {
		const groupIds = groups.map((g) => g.id);
		const groupFilter = groupIds.map((id) => `group="${id}"`).join(' || ');

		try {
			const allMembers = await locals.pb
				.collection('group_members')
				.getFullList<{ group: string }>({
					filter: groupFilter,
					fields: 'group'
				});
			const allQuestions = await locals.pb.collection('questions').getFullList<{ group: string }>({
				filter: groupFilter,
				fields: 'group'
			});

			for (const g of groups) {
				groupCounts[g.id] = {
					members: allMembers.filter((m) => m.group === g.id).length,
					questions: allQuestions.filter((q) => q.group === g.id).length
				};
			}
		} catch (err) {
			console.warn('[groups] Failed to fetch group counts', err);
			for (const g of groups) {
				groupCounts[g.id] = { members: 0, questions: 0 };
			}
		}
	}

	return {
		groups,
		groupCounts,
		isGlobalAdmin: locals.user?.role === 'admin'
	};
};
