import { error, redirect, isRedirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { ClientResponseError } from 'pocketbase';
import { PRIVATE_POCKETBASE_URL } from '$lib/server/env';

export const load: PageServerLoad = async ({ params, locals, url, fetch }) => {
	const token = params.token;

	let inviteType: 'group' | null = null;
	let targetEntity: any = null;

	// Check if it's a group invite
	try {
		const res = await fetch(`${PRIVATE_POCKETBASE_URL}/api/invites/${token}`);
		if (res.ok) {
			targetEntity = await res.json();
			inviteType = 'group';
		}
	} catch (err) {
		console.error('Error fetching group invite via API:', err);
	}

	if (!inviteType || !targetEntity) {
		throw error(404, 'Invalid or expired invite link.');
	}

	// If user is already logged in, check if they are already a member
	let alreadyMember = false;
	if (locals.user) {
		try {
			if (inviteType === 'group') {
				await locals.pb
					.collection('group_members')
					.getFirstListItem(`group="${targetEntity.id}" && user="${locals.user.id}"`);
				alreadyMember = true;
			}
		} catch (err) {
			// Expected if not a member
		}

		if (!alreadyMember && inviteType === 'group') {
			try {
				await locals.pb.send(`/api/invites/${token}/join`, {
					method: 'POST'
				});
				throw redirect(303, `/groups/${targetEntity.id}`);
			} catch (err) {
				if (isRedirect(err)) {
					throw err;
				}
				console.error('Auto-join failed:', err);
			}
		}
	}

	return {
		inviteType,
		targetId: targetEntity.id,
		title: targetEntity.name,
		description: targetEntity.description || '',
		alreadyMember,
		token,
		isAuthenticated: !!locals.user,
		redirectUrl: url.pathname
	};
};

export const actions: Actions = {
	accept: async ({ params, locals, fetch }) => {
		if (!locals.user) {
			throw redirect(303, `/login?redirect=/invite/${params.token}`);
		}

		const token = params.token;

		let inviteType: 'group' | null = null;
		let targetEntity: any = null;

		try {
			const res = await fetch(`${PRIVATE_POCKETBASE_URL}/api/invites/${token}`);
			if (res.ok) {
				targetEntity = await res.json();
				inviteType = 'group';
			}
		} catch {}

		if (!inviteType || !targetEntity) {
			throw error(404, 'Invalid or expired invite link.');
		}

		try {
			if (inviteType === 'group') {
				// Use the backend hook to join the group
				await locals.pb.send(`/api/invites/${token}/join`, {
					method: 'POST'
				});
				throw redirect(303, `/groups/${targetEntity.id}`);
			}
		} catch (err) {
			if (isRedirect(err)) {
				throw err; // Re-throw redirect
			}
			if (err instanceof ClientResponseError && !err.isAbort) {
				console.error('Error accepting invite:', err.response);
				return { success: false, message: 'Failed to accept invite or already a member.' };
			}
		}

		throw redirect(303, '/');
	}
};
