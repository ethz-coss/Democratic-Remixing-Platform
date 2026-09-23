import PocketBase, { ClientResponseError, type RecordModel } from 'pocketbase';
import { redirect } from '@sveltejs/kit';
import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { configurePocketBaseDebug } from '$lib/debug/pocketbase';
import {
	PRIVATE_API_DEBUG_LOGS,
	PRIVATE_API_DEBUG_LOGS_BODY,
	PRIVATE_POCKETBASE_URL,
	PRIVATE_PB_SUPERUSER_EMAIL,
	PRIVATE_PB_SUPERUSER_PASSWORD
} from '$lib/server/env';

/**
 * Cookie options shared by the canonical header-based approach
 * and the fallback SvelteKit cookies.delete() for clearing.
 */
const COOKIE_SERIALISE_OPTIONS = {
	httpOnly: true,
	path: '/',
	sameSite: true as const,
	secure: !dev
};

export interface AuthUser {
	id: string;
	created: string;
	email?: string;
	username?: string;
	name?: string;
	avatar?: string;
	simulation?: boolean;
	role?: string;
	has_consented?: boolean;
	has_seen_onboarding?: boolean;
	language?: string;
}

export interface ServerAuthContext {
	pb: PocketBase;
	authRecord: RecordModel | null;
	user: AuthUser | null;
}

export function createServerPocketBase(fetchFn?: typeof fetch) {
	const pb = new PocketBase(PRIVATE_POCKETBASE_URL);
	configurePocketBaseDebug(pb, {
		enabled: PRIVATE_API_DEBUG_LOGS,
		includeBody: PRIVATE_API_DEBUG_LOGS_BODY,
		context: 'server'
	});

	if (fetchFn) {
		pb.beforeSend = function (url, options) {
			options.fetch = options.fetch || fetchFn;
			return { url, options };
		};
	}

	return pb;
}

/**
 * Creates a PocketBase client authenticated as a superuser.
 * Use ONLY for server-side logic that requires bypassing collection rules.
 */
export async function createAdminPocketBase() {
	const pb = createServerPocketBase();
	if (!PRIVATE_PB_SUPERUSER_EMAIL || !PRIVATE_PB_SUPERUSER_PASSWORD) {
		console.warn('createAdminPocketBase: Missing superuser credentials in environment.');
		return pb;
	}

	try {
		// Try modern PocketBase _superusers collection first
		await pb
			.collection('_superusers')
			.authWithPassword(PRIVATE_PB_SUPERUSER_EMAIL, PRIVATE_PB_SUPERUSER_PASSWORD);
	} catch (err) {
		try {
			// Fallback to legacy _admins collection
			await pb
				.collection('_admins')
				.authWithPassword(PRIVATE_PB_SUPERUSER_EMAIL, PRIVATE_PB_SUPERUSER_PASSWORD);
		} catch (fallbackErr) {
			console.error(
				'createAdminPocketBase: Authentication failed for both _superusers and _admins.'
			);
		}
	}

	return pb;
}

// ---------------------------------------------------------------------------
// Cookie helpers — canonical PocketBase + SvelteKit pattern
//
// PocketBase SDK's exportToCookie() returns a complete Set-Cookie header string
// and loadFromCookie() expects the raw Cookie request header string.
//
// Using SvelteKit's cookies.set()/cookies.get() was causing encode/decode
// mismatches (the SDK URL-encodes internally, SvelteKit's cookie layer would
// double-encode or mis-decode). The canonical pattern is:
//   LOAD:  pb.authStore.loadFromCookie(request.headers.get('cookie'))
//   SAVE:  response.headers.append('set-cookie', pb.authStore.exportToCookie())
// ---------------------------------------------------------------------------

/**
 * Load auth state from the raw Cookie request header.
 * This uses PocketBase SDK's own cookie parser which correctly
 * handles its own encoding format.
 */
function loadAuthFromRequest(pb: PocketBase, request: Request) {
	pb.authStore.loadFromCookie(request.headers.get('cookie') || '');
}

/**
 * Return the Set-Cookie header value for the current auth state.
 * Must be appended to the response headers AFTER resolve().
 */
export function getAuthSetCookieHeader(pb: PocketBase): string {
	return pb.authStore.exportToCookie({
		httpOnly: COOKIE_SERIALISE_OPTIONS.httpOnly,
		path: COOKIE_SERIALISE_OPTIONS.path,
		sameSite: COOKIE_SERIALISE_OPTIONS.sameSite,
		secure: COOKIE_SERIALISE_OPTIONS.secure
	});
}

export async function refreshAuth(pb: PocketBase) {
	if (!pb.authStore.isValid) {
		return null;
	}

	try {
		const authData = await pb.collection('users').authRefresh();
		return authData.record;
	} catch (err) {
		if (
			err instanceof ClientResponseError &&
			(err.status === 401 || err.status === 403 || err.status === 404)
		) {
			pb.authStore.clear();
			return null;
		}
		// On transient network errors, keep the existing auth state valid
		console.warn(
			'[refreshAuth] Transient error refreshing auth token, keeping current session:',
			err
		);
		return pb.authStore.model;
	}
}

/**
 * Initialize auth for the current request.
 *
 * Called from the auth handle hook. Returns the auth context
 * but does NOT set any cookie — the hook is responsible for
 * appending the Set-Cookie header on the response after resolve().
 */
export async function initializeServerAuth(
	event: import('@sveltejs/kit').RequestEvent
): Promise<ServerAuthContext> {
	const pb = createServerPocketBase(event.fetch);

	// Load from raw Cookie header — PB SDK handles its own URL-decoding
	loadAuthFromRequest(pb, event.request);

	const authRecord = await refreshAuth(pb);

	return {
		pb,
		authRecord,
		user: recordToAuthUser(authRecord)
	};
}

/**
 * Authenticate a user by email+password.
 *
 * Does NOT set any cookie directly — the caller (form action) stores
 * the authenticated PB client in event.locals.pb, and the handle hook
 * serialises the cookie on the response.
 */
export async function authenticateServerUserWithPassword(
	pb: PocketBase,
	email: string,
	password: string
): Promise<ServerAuthContext> {
	const authData = await pb.collection('users').authWithPassword(email, password);

	return {
		pb,
		authRecord: authData.record,
		user: recordToAuthUser(authData.record)
	};
}

export function clearServerAuth(pb?: PocketBase) {
	if (pb) {
		pb.authStore.clear();
	}
}

function recordToAuthUser(record: RecordModel | null): AuthUser | null {
	if (!record) {
		return null;
	}

	return {
		id: record.id,
		created: record.created,
		email: typeof record.email === 'string' ? record.email : undefined,
		username: typeof record.username === 'string' ? record.username : undefined,
		name: typeof record.name === 'string' ? record.name : undefined,
		avatar: typeof record.avatar === 'string' ? record.avatar : undefined,
		simulation:
			record.simulation === true ||
			record.simulation === 'true' ||
			record.simulation === 1 ||
			record.simulation === '1',
		role: typeof record.role === 'string' ? record.role : undefined,
		has_consented:
			record.has_consented === true ||
			record.has_consented === 'true' ||
			record.has_consented === 1 ||
			record.has_consented === '1',
		has_seen_onboarding:
			record.has_seen_onboarding === true ||
			record.has_seen_onboarding === 'true' ||
			record.has_seen_onboarding === 1 ||
			record.has_seen_onboarding === '1',
		language: typeof record.language === 'string' ? record.language : undefined
	};
}

function requireUser(locals: App.Locals): AuthUser {
	if (!locals.user) {
		throw new Error('Authentication required.');
	}

	return locals.user;
}

export function requireUserOrRedirect(
	locals: App.Locals,
	redirectLocation = '/login',
	status: 302 | 303 = 303
): AuthUser {
	if (!locals.user) {
		throw redirect(status, redirectLocation);
	}

	return locals.user;
}
