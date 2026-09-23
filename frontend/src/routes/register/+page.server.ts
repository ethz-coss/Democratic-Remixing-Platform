import { fail, redirect } from '@sveltejs/kit';
import { ClientResponseError } from 'pocketbase';
import type { Actions, PageServerLoad } from './$types';
import { PRIVATE_POCKETBASE_URL } from '$lib/server/env';
import { authenticateServerUserWithPassword, createServerPocketBase } from '$lib/server/pb.server';
import { generateUsername } from '$lib/utils/username-generator';
import { getLocale } from '$lib/paraglide/runtime.js';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;

export const load: PageServerLoad = async ({ locals, url, fetch }) => {
	const token = url.searchParams.get('token') || url.searchParams.get('invite_token');

	if (locals.user) {
		if (token) {
			throw redirect(302, `/invite/${token}`);
		}
		throw redirect(302, '/');
	}
	const method = url.searchParams.get('method') === 'B' ? 'B' : 'A';

	let groupName = '';
	let groupId = '';

	if (token) {
		try {
			const res = await fetch(`${PRIVATE_POCKETBASE_URL}/api/invites/${token}`);
			if (res.ok) {
				const group = await res.json();
				groupName = String(group.name || '');
				groupId = String(group.id || '');
			}
		} catch {
			// Invalid token → we will just pass empty to force token input
		}
	}

	let suggestedUsername = '';
	for (let i = 0; i < 5; i++) {
		const candidate = generateUsername() + (i > 0 ? String(i) : '');
		const candidateEmail = `${candidate.toLowerCase()}@remix.local`;
		try {
			await locals.pb.collection('users').getFirstListItem(`email="${candidateEmail}"`);
			// Email exists, try again
		} catch (err) {
			if (err instanceof ClientResponseError && err.status === 404) {
				suggestedUsername = candidate;
				break;
			}
			// Other network error, try to fall back or break depending on strategy
		}
	}
	if (!suggestedUsername) {
		suggestedUsername = 'User_' + Math.random().toString(36).substring(2, 8);
	}

	const stepParam = url.searchParams.get('step');

	return {
		token: groupId ? token : null,
		groupName,
		groupId,
		suggestedUsername,
		method,
		stepParam
	};
};

export const actions: Actions = {
	validateToken: async ({ request, fetch }) => {
		const formData = await request.formData();
		const token = String(formData.get('token') ?? '').trim();
		const method = String(formData.get('method') ?? 'A').trim();

		if (!token) {
			return fail(400, {
				message: 'Invite token is required.',
				step: 'token',
				username: '',
				email: ''
			});
		}

		try {
			const res = await fetch(`${PRIVATE_POCKETBASE_URL}/api/invites/${token}`);
			if (res.ok) {
				const group = await res.json();
				return {
					success: true,
					token,
					groupName: group.name,
					groupId: group.id,
					method,
					username: ''
				};
			}
			return fail(400, { message: 'Invalid invite token.', step: 'token', username: '' });
		} catch {
			return fail(400, { message: 'Invalid invite token.', step: 'token', username: '' });
		}
	},
	register: async ({ request, cookies, locals, fetch }) => {
		const formData = await request.formData();

		// Token fields
		const token = String(formData.get('token') ?? '').trim();

		// Consent fields
		const method = formData.get('method') === 'B' ? 'B' : 'A';
		const c1 = formData.get('consent_1') === 'on';
		const c2 = formData.get('consent_2') === 'on';
		const c3 = formData.get('consent_3') === 'on';
		const final = formData.get('consent_final') === 'on';

		let c4 = false;
		let cScreen = false;
		let cStop = false;
		if (method === 'B') {
			cScreen = formData.get('consent_screen') === 'on';
			cStop = formData.get('consent_stop') === 'on';
		} else {
			c4 = formData.get('consent_4') === 'on';
		}

		if (
			!c1 ||
			!c2 ||
			!c3 ||
			!final ||
			(method === 'A' && !c4) ||
			(method === 'B' && (!cScreen || !cStop))
		) {
			return fail(400, {
				message: 'Please complete the consent form.',
				step: 'consent',
				token,
				username: ''
			});
		}

		// Account fields
		const username = String(formData.get('username') ?? '').trim();
		const password = String(formData.get('password') ?? '');
		const passwordConfirm = String(formData.get('passwordConfirm') ?? '');
		const name = username; // Auto-set name to username

		if (!token) {
			return fail(400, {
				message: 'An invite token is required to register.',
				step: 'token',
				username
			});
		}

		if (!USERNAME_RE.test(username)) {
			return fail(400, {
				message: 'Username must be 3-30 chars using letters, numbers, or _.',
				step: 'account',
				username,
				token
			});
		}

		if (password.length < 8 || password !== passwordConfirm) {
			return fail(400, { message: 'Check password fields.', step: 'account', username, token });
		}

		// Validate token via custom API route
		let group: { id: string; name?: string };
		try {
			const res = await fetch(`${PRIVATE_POCKETBASE_URL}/api/invites/${token}`);
			if (!res.ok) {
				return fail(400, { message: 'Invalid invite token.', step: 'token', username });
			}
			group = await res.json();
		} catch {
			return fail(400, { message: 'Invalid invite token.', step: 'token', username });
		}

		let userId = '';

		const dummyEmail = `${username.toLowerCase()}@remix.local`;
		try {
			const user = await locals.pb.collection('users').create({
				email: dummyEmail,
				emailVisibility: false,
				password,
				passwordConfirm,
				name,
				language: getLocale(),
				role: 'participant',
				user_agent: request.headers.get('user-agent') || ''
			});
			userId = user.id;
		} catch (err: any) {
			console.error(
				'[register] User creation failed. Status:',
				err?.status,
				'Message:',
				err?.message,
				'Data:',
				err?.response?.data
			);
			return fail(400, {
				message: 'Registration failed. Username may already be used.',
				step: 'account',
				username,
				token
			});
		}

		let authPb;
		try {
			const authContext = await authenticateServerUserWithPassword(locals.pb, dummyEmail, password);
			authPb = authContext.pb;
		} catch (err) {
			console.error('[register] Auth after creation failed', err);
			throw redirect(303, '/login?error=auth_failed_after_register');
		}

		// Create consent record using authenticated client (user creates their own)
		try {
			await authPb.collection('study_consents').create({
				user: userId,
				method,
				consented_at: new Date().toISOString(),
				consent_1: c1,
				consent_2: c2,
				consent_3: c3,
				consent_4: method === 'A' ? c4 : false,
				consent_screen: method === 'B' ? cScreen : false,
				consent_stop: method === 'B' ? cStop : false,
				consent_final: final,
				results_opt_in: false,
				results_email: ''
			});
		} catch (err) {
			console.error('[register] Failed to save consent', err);
		}

		let joinFailed = false;
		// Auto-join the group using the newly authenticated user client
		try {
			await authPb.send(`/api/invites/${token}/join`, {
				method: 'POST'
			});
		} catch (err) {
			console.error('[register] Failed to auto-join group after registration', err);
			joinFailed = true;
		}

		if (joinFailed) {
			throw redirect(303, `/?info=group_join_failed`);
		}
		throw redirect(303, `/`);
	}
};
