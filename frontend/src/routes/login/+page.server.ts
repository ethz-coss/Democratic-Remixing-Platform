import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { authenticateServerUserWithPassword } from '$lib/server/pb.server';
import { PRIVATE_API_DEBUG_LOGS } from '$lib/server/env';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) {
		throw redirect(302, '/');
	}
	const redirectTo = url.searchParams.get('redirect') || '';
	return { redirectTo };
};

export const actions: Actions = {
	default: async ({ request, cookies, locals }) => {
		const data = await request.formData();
		const usernameInput = String(data.get('username') ?? '').trim();
		const password = String(data.get('password') ?? '');
		const redirectTo = String(data.get('redirect') ?? '');
		const locale = String(data.get('locale') ?? '');

		if (!usernameInput || !password) {
			return fail(400, {
				message: 'Username/email and password are required.',
				username: usernameInput
			});
		}

		if (password.length < 8) {
			return fail(400, { message: 'Invalid credentials.', username: usernameInput });
		}

		const usernameLower = usernameInput.toLowerCase();
		const dummyEmail = `${usernameLower}@remix.local`;

		// Use the PB client from locals (created by the auth hook).
		// After auth succeeds, the hook will serialise the cookie
		// via response.headers.append('set-cookie', ...).
		let auth;
		try {
			auth = await authenticateServerUserWithPassword(locals.pb, dummyEmail, password);
			if (PRIVATE_API_DEBUG_LOGS) {
				console.log('[login] Auth succeeded with dummy email for:', usernameInput);
			}
		} catch (err1: any) {
			if (PRIVATE_API_DEBUG_LOGS) {
				console.error('[login] Failed with dummy email:', dummyEmail, err1?.status, err1?.message);
			}
			try {
				// Fallback: try raw input as identity (for admin-created users with real emails)
				auth = await authenticateServerUserWithPassword(locals.pb, usernameInput, password);
				if (PRIVATE_API_DEBUG_LOGS) {
					console.log('[login] Auth succeeded with raw identity for:', usernameInput);
				}
			} catch (err2: any) {
				console.error('[login] Failed with raw identity (HARD ERROR LOG):', usernameInput, err2?.status, err2?.message, err2);
				if (PRIVATE_API_DEBUG_LOGS) {
					console.error(
						'[login] Failed with raw identity:',
						usernameInput,
						err2?.status,
						err2?.message
					);
				}
				return fail(400, { message: `Invalid credentials. Details: ${err2?.status} ${err2?.message}`, username: usernameInput });
			}
		}

		if (auth.user) {
			const finalLocale = auth.user.language || locale;
			if (finalLocale) {
				if (auth.user.language !== finalLocale) {
					try {
						await auth.pb.collection('users').update(auth.user.id, { language: finalLocale });
					} catch (e) {
						console.error('Failed to update user language on login', e);
					}
				}
				cookies.set('paraglide_locale', finalLocale, {
					path: '/',
					maxAge: 60 * 60 * 24 * 365,
					httpOnly: false,
					sameSite: 'lax'
				});
			}
		}

		// Only allow relative paths for security
		const safeRedirect = redirectTo && redirectTo.startsWith('/') ? redirectTo : '/';
		throw redirect(303, safeRedirect);
	}
};
