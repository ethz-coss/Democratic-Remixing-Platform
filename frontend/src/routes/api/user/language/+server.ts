import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let language: string;
	try {
		const body = await request.json();
		language = body.language;
	} catch {
		return json({ error: 'Invalid request body' }, { status: 400 });
	}

	if (!language || typeof language !== 'string') {
		return json({ error: 'Invalid language' }, { status: 400 });
	}

	try {
		await locals.pb.collection('users').update(locals.user.id, {
			language
		});

		// Also update the paraglide_locale cookie so the next page load picks it up if no path is provided.
		cookies.set('paraglide_locale', language, {
			path: '/',
			maxAge: 60 * 60 * 24 * 365, // 1 year
			httpOnly: false, // Must be accessible or readable by Paraglide? Paraglide sets it on the server, so it's fine.
			sameSite: 'lax'
		});

		return json({ success: true });
	} catch (err) {
		console.error('[api/user/language] Failed to update language', err);
		return json({ error: 'Failed to update language' }, { status: 500 });
	}
};
