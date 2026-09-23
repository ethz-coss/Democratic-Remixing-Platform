import { requireUserOrRedirect } from '$lib/server/pb.server';
import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

function generateToken(length = 32) {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let token = '';
	for (let i = 0; i < length; i++) {
		token += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return token;
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireUserOrRedirect(locals, '/login?redirect=/admin/groups');

	if (user.role !== 'admin') {
		throw error(403, 'Only administrators can access this page.');
	}

	// Fetch all groups via standard client (rules now allow admins)
	const allGroups = await locals.pb.collection('groups').getFullList({
		sort: '-created',
		expand: 'author'
	});

	// Fetch all questions to map them to groups
	const allQuestions = await locals.pb.collection('questions').getFullList({
		sort: '-created'
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
			const groupQuestions = allQuestions
				.filter((q) => q.group === group.id)
				.map((q) => ({ id: q.id, title: q.title }));

			return {
				id: group.id,
				name: group.name,
				description: group.description || '',
				invite_token: group.invite_token,
				created: group.created,
				authorName: group.expand?.author?.name || group.expand?.author?.username || 'Unknown',
				memberCount: members.length,
				questions: groupQuestions
			};
		})
	);

	return {
		groups: groupsWithCounts
	};
};

export const actions: Actions = {
	createGroup: async ({ request, locals }) => {
		const user = requireUserOrRedirect(locals, '/login');

		if (user.role !== 'admin') {
			return fail(403, { error: 'Only administrators can create groups.' });
		}

		const data = await request.formData();
		const name = data.get('name')?.toString();
		const description = data.get('description')?.toString() || '';

		if (!name || name.length < 3) {
			return fail(400, { name, description, error: 'Name must be at least 3 characters long.' });
		}

		try {
			// Create the group — createRule requires role='admin'
			const group = await locals.pb.collection('groups').create({
				name,
				description,
				author: user.id,
				invite_token: generateToken()
			});

			// Auto-join as Admin member so the group is visible via listRule
			await locals.pb.collection('group_members').create({
				group: group.id,
				user: user.id,
				role: 'Admin'
			});

			throw redirect(303, `/groups/${group.id}`);
		} catch (err) {
			if (err instanceof Response) throw err; // Re-throw redirect
			// SvelteKit redirect() throws a Redirect object, not Response
			if (
				err &&
				typeof err === 'object' &&
				'status' in err &&
				(err as { status: number }).status === 303
			)
				throw err;
			console.error('Error creating group:', err);
			return fail(500, { name, description, error: 'Failed to create group. Please try again.' });
		}
	},
	regenerateToken: async ({ request, locals }) => {
		const user = requireUserOrRedirect(locals, '/login?redirect=/admin/groups');

		if (user.role !== 'admin') {
			return fail(403, { error: 'Only administrators can regenerate the invite link.' });
		}

		const data = await request.formData();
		const groupId = data.get('groupId')?.toString();

		if (!groupId) {
			return fail(400, { error: 'Group ID is required.' });
		}

		const newToken = generateToken(32);

		try {
			await locals.pb.collection('groups').update(groupId, {
				invite_token: newToken
			});
		} catch (err) {
			console.error('Error regenerating invite token:', err);
			return fail(500, { error: 'Failed to regenerate invite link. Please try again.' });
		}

		return { regenerated: true };
	}
};
