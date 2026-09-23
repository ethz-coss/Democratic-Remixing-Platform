import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { redirect } from '@sveltejs/kit';
import { initializeServerAuth, getAuthSetCookieHeader } from '$lib/server/pb.server';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { getTextDirection, extractLocaleFromUrl, localizeUrl } from '$lib/paraglide/runtime';

const PUBLIC_ROUTE_IDS = new Set([
	'/login',
	'/register',
	'/invite/[token]',
	'/api/push-send',
	'/api/push-action'
]);
const GUEST_ONLY_ROUTE_IDS = new Set(['/login', '/register']);

const populateAuthHandle: Handle = async ({ event, resolve }) => {
	const auth = await initializeServerAuth(event);
	event.locals.pb = auth.pb;
	event.locals.user = auth.user;
	return resolve(event);
};

const languageSyncHandle: Handle = async ({ event, resolve }) => {
	const cookieHeader = event.request.headers.get('cookie') || '';
	const match = cookieHeader.match(/paraglide_locale=([^;]+)/);
	const currentCookieLocale = match ? match[1] : null;

	let targetLocale = currentCookieLocale;

	if (event.locals.user && event.locals.user.language) {
		targetLocale = event.locals.user.language;
	} else if (!currentCookieLocale) {
		const acceptLanguage = event.request.headers.get('accept-language');
		if (acceptLanguage) {
			const preferred = acceptLanguage.split(',')[0].split(';')[0].trim().toLowerCase();
			targetLocale = preferred.startsWith('de') ? 'de' : 'en';
		} else {
			targetLocale = 'en';
		}
	}

	const isDocument = event.request.headers.get('sec-fetch-dest') === 'document';
	const isPageNavigation = isDocument || event.isDataRequest;

	if (!event.url.pathname.startsWith('/api/') && isPageNavigation) {
		const urlLocale = extractLocaleFromUrl(event.url.href) || 'en';
		if (targetLocale && targetLocale !== urlLocale) {
			const localized = localizeUrl(event.url.href, { locale: targetLocale as any });
			if (localized.pathname !== event.url.pathname) {
				event.cookies.set('paraglide_locale', targetLocale, {
					path: '/',
					maxAge: 31536000,
					httpOnly: false,
					sameSite: 'lax'
				});
				throw redirect(307, localized.pathname + localized.search);
			}
		}
	}

	let response: Response;

	if (targetLocale && targetLocale !== currentCookieLocale) {
		const newCookie = currentCookieLocale
			? cookieHeader.replace(
					`paraglide_locale=${currentCookieLocale}`,
					`paraglide_locale=${targetLocale}`
				)
			: cookieHeader
				? `${cookieHeader}; paraglide_locale=${targetLocale}`
				: `paraglide_locale=${targetLocale}`;

		event.request.headers.set('cookie', newCookie);

		response = await resolve(event);
		response.headers.append(
			'set-cookie',
			`paraglide_locale=${targetLocale}; Path=/; Max-Age=31536000; SameSite=Lax`
		);
	} else {
		response = await resolve(event);
	}

	return response;
};

const paraglideHandle: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request: localizedRequest, locale }) => {
		event.request = localizedRequest;

		// SvelteKit 2 handles URL routing via the `reroute` hook in `src/hooks.ts`.
		// We no longer mutate `event.url`, which caused incorrect relative paths (404 for assets).

		return resolve(event, {
			transformPageChunk: ({ html }) => {
				return html.replace('%lang%', locale).replace('%dir%', getTextDirection(locale));
			}
		});
	});

const routeGuardHandle: Handle = async ({ event, resolve }) => {
	const routeId = event.route.id;
	const isRouteRequest = routeId !== null;
	const isPublicRoute = isRouteRequest && PUBLIC_ROUTE_IDS.has(routeId);
	const isGuestOnlyRoute = isRouteRequest && GUEST_ONLY_ROUTE_IDS.has(routeId);

	if (isRouteRequest && !event.locals.user && !isPublicRoute) {
		throw redirect(303, '/login');
	}

	if (isRouteRequest && event.locals.user && isGuestOnlyRoute) {
		throw redirect(303, '/');
	}

	// Resolve the request (runs load functions + actions)
	const response = await resolve(event);

	// After resolve(), the PB client in event.locals.pb may have been
	// updated by a form action (e.g. login, register, logout).
	// Serialise the current auth state as a Set-Cookie header.
	response.headers.append('set-cookie', getAuthSetCookieHeader(event.locals.pb));

	return response;
};

export const handle = sequence(
	populateAuthHandle,
	languageSyncHandle,
	paraglideHandle,
	routeGuardHandle
);
