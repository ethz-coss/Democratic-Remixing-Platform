import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clearServerAuth } from '$lib/server/pb.server';

export const POST: RequestHandler = async ({ locals, cookies }) => {
	clearServerAuth(locals.pb);
	throw redirect(303, '/login');
};
