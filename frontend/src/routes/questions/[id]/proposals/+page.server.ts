import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	normalizeProposalRecord,
	parseProposalVoteValue,
	submitProposalVote
} from '$lib/server/proposals';
import { escapeFilter, getPocketBaseErrorMessage } from '$lib/server/questions';
import { PRIVATE_POCKETBASE_URL } from '$lib/server/env';
import { localizePath } from '$lib/utils/i18n-path.js';

// Redirect bare /proposals to /proposals/question on GET navigation.
// This does NOT re-run after form action responses, avoiding redirect loops.
export const load: PageServerLoad = ({ params }) => {
	throw redirect(303, localizePath(`/questions/${params.id}/proposals/question`));
};

export const actions: Actions = {
	vote: async ({ request, locals, params }) => {
		if (!locals.user) {
			return fail(401, { message: 'You must be logged in to vote.' });
		}

		const formData = await request.formData();
		let voteValue: number;
		try {
			voteValue = parseProposalVoteValue(formData.get('vote'));
		} catch (err) {
			return fail(400, {
				message: err instanceof Error ? err.message : 'Vote must be 1 or -1.'
			});
		}

		const proposalId = String(formData.get('proposalId') ?? '').trim();
		if (!proposalId) {
			return fail(400, { message: 'Missing proposal id.' });
		}

		const simulatedAt = formData.get('simulated_at')?.toString();
		const occurredAt = simulatedAt ? new Date(simulatedAt).toISOString() : undefined;

		try {
			const result = await submitProposalVote({
				pb: locals.pb,
				userId: locals.user.id,
				proposalId,
				questionId: params.id,
				voteValue,
				occurredAt
			});

			const actionType = voteValue > 0 ? 'subscribe' : 'unsubscribe';
			await locals.pb
				.collection('action_logs')
				.create({
					question: params.id,
					user: locals.user.id,
					action_type: actionType,
					target_id: proposalId,
					occurred_at: occurredAt || new Date().toISOString()
				})
				.catch((e) => console.error('[action_logs] failed to log vote', e));

			return {
				ok: true,
				...result
			};
		} catch (err) {
			return fail(400, {
				message: getPocketBaseErrorMessage(err, 'Failed to submit vote.')
			});
		}
	},

	// Repeal action has been removed

	hide: async ({ request, locals, params }) => {
		if (!locals.user) {
			return fail(401, { message: 'You must be logged in to hide.' });
		}
		const formData = await request.formData();
		const proposalId = String(formData.get('proposalId') ?? '').trim();
		if (!proposalId) return fail(400, { message: 'Missing proposal id.' });

		try {
			const created = await locals.pb.collection('proposal_hides').create({
				user: locals.user.id,
				proposal: proposalId
			});
			await locals.pb
				.collection('action_logs')
				.create({
					question: params.id,
					user: locals.user.id,
					action_type: 'hide_proposal',
					target_id: proposalId,
					occurred_at: new Date().toISOString()
				})
				.catch((e) => console.error('[action_logs] failed to log hide', e));
			return { ok: true };
		} catch (err: any) {
			// Ignore if already hidden
			if (err?.status !== 400) {
				console.error('Failed to hide:', err);
			}
			return { ok: true };
		}
	},

	unhide: async ({ request, locals, params }) => {
		if (!locals.user) return fail(401);
		const formData = await request.formData();
		const proposalId = String(formData.get('proposalId') ?? '').trim();
		if (!proposalId) return fail(400);

		try {
			const record = await locals.pb
				.collection('proposal_hides')
				.getFirstListItem(`user="${locals.user.id}" && proposal="${proposalId}"`);
			if (record) {
				await locals.pb.collection('proposal_hides').delete(record.id);
				await locals.pb
					.collection('action_logs')
					.create({
						question: params.id,
						user: locals.user.id,
						action_type: 'restore_proposal',
						target_id: proposalId,
						occurred_at: new Date().toISOString()
					})
					.catch((e) => console.error('[action_logs] failed to log restore', e));
			}
			return { ok: true };
		} catch (err) {
			return { ok: true };
		}
	},

	toggleReproposalSignal: async ({ locals, params, fetch }) => {
		if (!locals.user) {
			return fail(401, { message: 'You must be logged in to signal readiness.' });
		}

		try {
			// Call PocketBase's custom route directly (motion.pb.js routerAdd).
			// This uses $app.save() internally which bypasses collection rules,
			// avoiding the need for superuser credentials.
			const pbUrl = `${PRIVATE_POCKETBASE_URL}/api/questions/${params.id}/toggle-motion`;
			const res = await fetch(pbUrl, {
				method: 'POST',
				headers: {
					Authorization: locals.pb.authStore.token
				}
			});

			if (!res.ok) {
				const error = await res.json().catch(() => ({ message: 'Failed to toggle readiness.' }));
				return fail(res.status, { message: error.message || 'Failed to toggle readiness.' });
			}

			const data = await res.json();

			await locals.pb
				.collection('action_logs')
				.create({
					question: params.id,
					user: locals.user.id,
					action_type: 'readiness_signal',
					metadata_json: {
						userHasSignaled: Boolean(data.userHasSignaled),
						signalsCount: Number(data.signalsCount ?? 0)
					},
					occurred_at: new Date().toISOString()
				})
				.catch((e) => console.error('[action_logs] failed to log readiness signal', e));

			return {
				ok: true,
				userHasSignaled: Boolean(data.userHasSignaled),
				signalsCount: Number(data.signalsCount ?? 0)
			};
		} catch (err) {
			console.error('[toggleReproposalSignal] failed', err);
			return fail(400, {
				message: getPocketBaseErrorMessage(err, 'Failed to toggle readiness signal.')
			});
		}
	}
};
