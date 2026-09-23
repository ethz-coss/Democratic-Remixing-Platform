import type { LayoutServerLoad } from './$types';
import { escapeFilter } from '$lib/server/questions';
import { redirect } from '@sveltejs/kit';

export const load: LayoutServerLoad = async ({ locals, route, fetch }) => {
	if (
		locals.user &&
		!locals.user.has_seen_onboarding &&
		!route.id?.startsWith('/how-it-works') &&
		!route.id?.startsWith('/logout')
	) {
		throw redirect(303, '/how-it-works?onboarding=true');
	}

	const surveyUnlocked = true;
	let surveyCompleted = false;
	let userGroups: Array<{ id: string; name: string }> = [];

	if (locals.user) {
		try {
			userGroups = await locals.pb.collection('groups').getFullList<{
				id: string;
				name: string;
			}>({
				requestKey: 'root-layout-user-groups',
				fetch
			});
		} catch (err) {
			console.warn('[root:layout] Failed to fetch user groups', err);
		}

		try {
			const surveyRecord = await locals.pb
				.collection('post_study_surveys')
				.getFirstListItem(`user = "${locals.user.id}"`, {
					requestKey: 'root-layout-survey-completed',
					fetch
				});
			surveyCompleted = !!surveyRecord;
		} catch (err) {
			surveyCompleted = false;
		}
	}

	let pushLogs: any[] = [];
	if (locals.user) {
		try {
			const result = await locals.pb.collection('push_notification_log').getList(1, 20, {
				filter: `user = "${locals.user.id}" && status = "pending"`,
				sort: '-created',
				requestKey: 'root-layout-push-logs',
				fetch
			});
			pushLogs = result.items
				.map((item) => {
					let parsedPayload = item.payload_json;
					if (typeof parsedPayload === 'string') {
						try {
							parsedPayload = JSON.parse(parsedPayload);
						} catch (e) {}
					}
					return {
						id: item.id,
						event_type: item.event_type,
						reference_id: item.reference_id,
						status: item.status,
						payload_json: parsedPayload || {},
						created: item.created
					};
				})
				.filter((log) => {
					const p = log.payload_json;
					return p && (p.title || p.body);
				});
		} catch (err) {
			console.warn('[root:layout] Failed to fetch push logs', err);
		}
	}

	return {
		user: locals.user,
		surveyUnlocked,
		surveyCompleted,
		notifications: {
			pushLogs
		},
		userGroups
	};
};
