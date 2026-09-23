import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getPocketBaseErrorMessage, parseQuestionPayloadFromFormData } from '$lib/server/questions';
import { requireUserOrRedirect } from '$lib/server/pb.server';
import { localizePath } from '$lib/utils/i18n-path.js';

function extractSubmittedValues(formData: FormData) {
	const title = String(formData.get('title') ?? '');
	const description = String(formData.get('description') ?? '');
	const currentPhaseName = formData.get('currentPhaseName')
		? String(formData.get('currentPhaseName'))
		: undefined;
	const rawConstraintsJson = String(formData.get('constraintsJson') ?? '').trim();
	let constraints: string[] = [];

	if (rawConstraintsJson) {
		try {
			const parsed = JSON.parse(rawConstraintsJson);
			if (Array.isArray(parsed)) {
				constraints = parsed.map((value) => String(value ?? '').trim()).filter(Boolean);
			}
		} catch {
			constraints = [];
		}
	}

	if (constraints.length === 0) {
		constraints = formData
			.getAll('constraints')
			.map((value) => String(value ?? '').trim())
			.filter(Boolean);
	}

	return {
		title,
		description,
		constraints,
		currentPhaseName
	};
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireUserOrRedirect(locals, '/login', 302);

	const groupsMap = new Map();

	if (user.role === 'admin') {
		const allGroups = await locals.pb.collection('groups').getFullList();
		for (const g of allGroups) {
			groupsMap.set(g.id, g);
		}
	} else {
		// Fetch groups where user is author or member
		const groupMemberships = await locals.pb.collection('group_members').getFullList({
			filter: `user="${user.id}"`,
			expand: 'group'
		});

		for (const m of groupMemberships) {
			if (m.expand?.group) {
				groupsMap.set(m.expand.group.id, m.expand.group);
			}
		}
	}

	return {
		user,
		groups: Array.from(groupsMap.values())
	};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const user = requireUserOrRedirect(locals);

		const formData = await request.formData();
		const submitted = extractSubmittedValues(formData);

		let payload: ReturnType<typeof parseQuestionPayloadFromFormData>;
		try {
			payload = parseQuestionPayloadFromFormData(formData);
		} catch (err) {
			return fail(400, {
				message: err instanceof Error ? err.message : 'Invalid question payload.',
				...submitted
			});
		}

		let created: { id?: string } | null = null;
		try {
			const visibility = formData.get('visibility')?.toString() || 'Public';
			const group = formData.get('group')?.toString();
			const currentPhaseName = formData.get('currentPhaseName')?.toString();
			const discussionDeadline = formData.get('discussion_deadline')?.toString();
			const closingWindowDeadline = formData.get('closing_window_deadline')?.toString();
			const voteDeadline = formData.get('vote_deadline')?.toString();

			const createData: any = {
				author: user.id,
				title: payload.title,
				description: payload.description,
				constraints: JSON.stringify(payload.constraints),
				visibility: ['Public', 'Group', 'Private'].includes(visibility) ? visibility : 'Public',
				focus_quorum: payload.selectionTriggerThresholdPercent
			};

			if (discussionDeadline) createData.discussion_deadline = discussionDeadline;
			if (closingWindowDeadline) createData.closing_window_deadline = closingWindowDeadline;
			if (voteDeadline) createData.vote_deadline = voteDeadline;

			if (user.role === 'admin' && currentPhaseName) {
				createData.current_phase_name = currentPhaseName;
			}

			if (group) {
				createData.group = group;
			}

			if (createData.visibility === 'Private') {
				// generate invite token for private questions
				const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
				let token = '';
				for (let i = 0; i < 32; i++) {
					token += chars.charAt(Math.floor(Math.random() * chars.length));
				}
				createData.invite_token = token;
			}

			created = await locals.pb.collection('questions').create(createData);
		} catch (err) {
			return fail(400, {
				message: getPocketBaseErrorMessage(err, 'Failed to create question.'),
				...submitted
			});
		}

		if (!created?.id) {
			return fail(400, {
				message: 'Failed to create question.',
				...submitted
			});
		}

		throw redirect(303, localizePath(`/questions/${String(created.id)}`));
	}
};
