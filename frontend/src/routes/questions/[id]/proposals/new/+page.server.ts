import { error, fail, redirect } from '@sveltejs/kit';
import { ClientResponseError } from 'pocketbase';
import type { Actions, PageServerLoad } from './$types';
import {
	buildQuestionScoreMap,
	deriveQuestionState,
	escapeFilter,
	getPocketBaseErrorMessage,
	normalizeQuestionRecord
} from '$lib/server/questions';
import { requireUserOrRedirect } from '$lib/server/pb.server';
import { stripRichText } from '$lib/markdown';
import { localizePath } from '$lib/utils/i18n-path.js';

async function isAuthoringPhaseOpen(
	pb: App.Locals['pb'],
	questionId: string,
	status: App.QuestionRecord['current_phase_name']
): Promise<boolean> {
	// Authoring is open in AnswerSearch; blocked in Proposed and FinalReproposal
	if (status === 'AnswerSearch') {
		return true;
	}

	return false;
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
	let rawQuestion: Record<string, unknown>;
	try {
		rawQuestion = await locals.pb.collection('questions').getOne(params.id, {
			expand: 'current_phase'
		});
	} catch (err) {
		if (err instanceof ClientResponseError && err.status === 404) {
			throw error(404, 'Question not found.');
		}

		throw err;
	}
	let questionVotes: App.QuestionVoteRecord[] = [];
	try {
		questionVotes = await locals.pb
			.collection('question_votes')
			.getFullList<App.QuestionVoteRecord>({
				filter: `question = "${escapeFilter(params.id)}"`
			});
	} catch {
		questionVotes = [];
	}

	const scoreByQuestion = buildQuestionScoreMap(questionVotes);
	const question = deriveQuestionState(
		normalizeQuestionRecord(rawQuestion),
		scoreByQuestion[params.id] ?? 0
	);
	const canAuthor = await isAuthoringPhaseOpen(locals.pb, params.id, question.current_phase_name);

	if (!canAuthor) {
		throw redirect(
			303,
			localizePath(
				`/questions/${params.id}/proposals?authoring_phase=${encodeURIComponent(question.current_phase_name)}`
			)
		);
	}

	requireUserOrRedirect(locals);

	return {
		question,
		user: locals.user
	};
};

export const actions: Actions = {
	default: async ({ request, locals, params }) => {
		const requestId = crypto.randomUUID().slice(0, 8);
		const user = requireUserOrRedirect(locals);

		const formData = await request.formData();
		const title = String(formData.get('title') ?? '').trim();
		const content = String(formData.get('content') ?? '');
		const contentText = stripRichText(content);
		const labelStr = String(formData.get('label') ?? '').trim();

		if (title.length < 1 || title.length > 120) {
			console.warn(`[proposal:create:new:${requestId}] rejected title length`, {
				titleLength: title.length
			});
			return fail(400, {
				message: 'Idea title is required and must be at most 120 characters.',
				title,
				content,
				labelStr
			});
		}

		if (contentText.length < 5) {
			console.warn(`[proposal:create:new:${requestId}] rejected content too short`, {
				contentLength: content.length,
				contentTextLength: contentText.length
			});
			return fail(400, {
				message: 'Proposal content must be at least 5 characters.',
				title,
				content,
				labelStr
			});
		}

		const rawQuestion = await locals.pb.collection('questions').getOne(params.id, {
			expand: 'current_phase'
		});
		const question = normalizeQuestionRecord(rawQuestion);
		const canAuthor = await isAuthoringPhaseOpen(locals.pb, params.id, question.current_phase_name);
		if (!canAuthor) {
			console.warn(`[proposal:create:new:${requestId}] rejected status`, {
				status: question.current_phase_name
			});
			return fail(400, {
				message: 'This question is not in a proposal-authoring phase.',
				title,
				content,
				labelStr
			});
		}

		let created: { id?: string } | null = null;
		let primaryLabelId: string | undefined = undefined;

		const effectiveLabelStr = labelStr ? labelStr.trim() : title.trim().substring(0, 40);

		if (effectiveLabelStr) {
			try {
				const existing = await locals.pb
					.collection('labels')
					.getFirstListItem(
						`question="${escapeFilter(params.id)}" && short_name~"${escapeFilter(effectiveLabelStr)}"`
					);
				primaryLabelId = existing.id;
			} catch {
				try {
					const colors = [
						'#f87171',
						'#fb923c',
						'#fbbf24',
						'#a3e635',
						'#4ade80',
						'#34d399',
						'#2dd4bf',
						'#38bdf8',
						'#60a5fa',
						'#818cf8',
						'#a78bfa',
						'#c084fc',
						'#e879f9',
						'#f472b6',
						'#fb7185'
					];
					const randomColor = colors[Math.floor(Math.random() * colors.length)];
					const newLabel = await locals.pb.collection('labels').create({
						question: params.id,
						short_name: effectiveLabelStr,
						color: randomColor
					});
					primaryLabelId = newLabel.id;
				} catch (e) {
					console.error(`[proposal:create:new:${requestId}] Failed to create label`, e);
				}
			}
		}

		try {
			const occurredAt = new Date().toISOString();

			const payload: Record<string, unknown> = {
				question: params.id,
				author: user.id,
				title,
				content,
				reason_for_change: '', // Empty for root ideas
				parent_proposals: [], // Empty for root ideas
				state: 'Proposed',
				...(primaryLabelId ? { primary_label: primaryLabelId, labels: [primaryLabelId] } : {})
			};

			created = await locals.pb.collection('proposals').create(payload);

			if (created?.id) {
				await locals.pb
					.collection('action_logs')
					.create({
						question: params.id,
						user: user.id,
						action_type: 'create_idea',
						target_id: created.id,
						occurred_at: occurredAt
					})
					.catch((e) => console.error('[action_logs] failed to log creation', e));

				if (effectiveLabelStr && primaryLabelId) {
					await locals.pb
						.collection('action_logs')
						.create({
							question: params.id,
							user: user.id,
							action_type: 'create_label',
							target_id: primaryLabelId,
							metadata_json: { label_name: effectiveLabelStr },
							occurred_at: occurredAt
						})
						.catch((e) => console.error('[action_logs] failed to log label creation', e));
				}
			}
		} catch (err) {
			console.error(`[proposal:create:new:${requestId}] pocketbase create failed`, err);
			return fail(400, {
				message: getPocketBaseErrorMessage(err, 'Failed to publish proposal.'),
				title,
				content,
				labelStr
			});
		}

		if (!created?.id) {
			console.error(`[proposal:create:new:${requestId}] create returned no id`, { created });
			return fail(400, { message: 'Failed to publish proposal.' });
		}

		throw redirect(303, localizePath(`/questions/${params.id}/proposals/${created.id}`));
	}
};
