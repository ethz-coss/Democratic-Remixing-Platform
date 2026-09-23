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
import { normalizeProposalRecord } from '$lib/server/proposals';
import { requireUserOrRedirect } from '$lib/server/pb.server';
import { stripRichText } from '$lib/markdown';
import { localizePath } from '$lib/utils/i18n-path.js';

export function _parseParentIds(input: string | null): string[] {
	if (!input) {
		return [];
	}

	return [
		...new Set(
			input
				.split(',')
				.map((item) => item.trim())
				.filter(Boolean)
		)
	];
}

export function _parseParentIdsFromFormData(formData: FormData): string[] {
	return [
		...new Set(
			formData
				.getAll('parent_ids')
				.map((value) => String(value ?? '').trim())
				.filter(Boolean)
		)
	];
}

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
	const requestedParentIds = _parseParentIds(url.searchParams.get('parents')).slice(0, 2);
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

	if (_parseParentIds(url.searchParams.get('parents')).length > 2) {
		throw redirect(303, localizePath(`/questions/${params.id}/proposals`));
	}

	let questionProposals: App.ProposalRecord[] = [];
	try {
		const rawProposals = await locals.pb
			.collection('proposals')
			.getFullList<Record<string, unknown>>({
				filter: `question = "${escapeFilter(question.id)}"`,
				sort: '-id'
			});
		questionProposals = rawProposals.map((item) => normalizeProposalRecord(item));
	} catch {
		questionProposals = [];
	}

	const candidateById = new Map(questionProposals.map((proposal) => [proposal.id, proposal]));
	const parentOptions = questionProposals
		.filter((proposal) => proposal.state !== 'FinalWinner')
		.sort((a, b) => a.title.localeCompare(b.title));
	const parentProposals = requestedParentIds
		.map((id) => candidateById.get(id))
		.filter((proposal): proposal is App.ProposalRecord => Boolean(proposal));

	if (requestedParentIds.length !== parentProposals.length) {
		throw redirect(303, `/questions/${params.id}/proposals`);
	}

	let initialContent = '';
	let initialTitle = '';
	let mode: 'root' | 'branch' = 'root';

	if (parentProposals.length >= 1) {
		mode = 'branch';
		initialContent = parentProposals.map((parent) => parent.content).join('\n<hr/>\n');
		initialTitle =
			parentProposals.length === 1
				? parentProposals[0].title
				: `Salvage merge: ${parentProposals.map((parent) => parent.title).join(' + ')}`;
	}

	// Archived concept removed in v2 — all parents are valid if Proposed
	const needsPassingParentSelection = false;

	return {
		question,
		user: locals.user,
		parentOptions,
		parentProposals,
		parentIds: parentProposals.map((parent) => parent.id),
		needsPassingParentSelection,
		initialContent,
		initialTitle,
		mode
	};
};

export const actions: Actions = {
	default: async ({ request, locals, params }) => {
		try {
			const requestId = crypto.randomUUID().slice(0, 8);
			const user = requireUserOrRedirect(locals);

			const formData = await request.formData();
			const title = String(formData.get('title') ?? '').trim();
			const content = String(formData.get('content') ?? '');
			const contentText = stripRichText(content);
			const reasonForChange = String(formData.get('reason_for_change') ?? '');
			const reasonForChangeText = stripRichText(reasonForChange);
			const labelStr = String(formData.get('label') ?? '').trim();
			const parentIds = _parseParentIdsFromFormData(formData).slice(0, 2);

			const baseParent = String(formData.get('base_parent') ?? '').trim() || undefined;

			if (title.length < 1 || title.length > 120) {
				console.warn(`[proposal:create:${requestId}] rejected title length`, {
					titleLength: title.length
				});
				return fail(400, {
					message: 'Proposal title is required and must be at most 120 characters.'
				});
			}

			if (contentText.length < 5) {
				console.warn(`[proposal:create:${requestId}] rejected content too short`, {
					contentLength: content.length,
					contentTextLength: contentText.length
				});
				return fail(400, {
					message: 'Proposal content must be at least 5 characters.'
				});
			}

			if (parentIds.length > 0 && reasonForChangeText.length < 3) {
				return fail(400, {
					message: 'Reason for change is required when remixing a proposal.'
				});
			}

			if (reasonForChangeText.length > 100) {
				return fail(400, {
					message: 'Reason for change must be at most 100 characters.'
				});
			}

			const rawQuestion = await locals.pb.collection('questions').getOne(params.id, { expand: 'current_phase' });
			const question = normalizeQuestionRecord(rawQuestion);
			const canAuthor = await isAuthoringPhaseOpen(
				locals.pb,
				params.id,
				question.current_phase_name
			);
			if (!canAuthor) {
				console.warn(`[proposal:create:${requestId}] rejected status`, {
					status: question.current_phase_name
				});
				return fail(400, {
					message: 'This question is not in a proposal-authoring phase.'
				});
			}

			if (parentIds.length > 2) {
				return fail(400, {
					message: 'You can remix at most two parent proposals.'
				});
			}

			if (baseParent && !parentIds.includes(baseParent)) {
				return fail(400, {
					message: 'Base parent must be one of the selected parent proposals.'
				});
			}

			if (parentIds.length > 0) {
				try {
					const parentFilter = parentIds.map((id) => `id = "${escapeFilter(id)}"`).join(' || ');
					const parentResultsRaw = await locals.pb.collection('proposals').getFullList({
						filter: `question = "${escapeFilter(params.id)}" && (${parentFilter})`
					});
					const parentResults = parentResultsRaw.map((item) =>
						normalizeProposalRecord(item as Record<string, unknown>)
					);

					if (parentResults.length !== parentIds.length) {
						throw new Error('One or more parent proposals are invalid for this question.');
					}

					// Archived concept removed in v2
					const hasArchivedParent = false;
					const hasPassingParent = parentResults.some((proposal) => proposal.state === 'Proposed');
					if (hasArchivedParent && !hasPassingParent) {
						return fail(400, {
							message:
								'Select at least one passing (Proposed) parent when remixing an archived proposal.'
						});
					}
				} catch (err) {
					if (err && typeof err === 'object' && 'status' in err) {
						throw err;
					}
					console.warn(`[proposal:create:${requestId}] rejected invalid parent`, {
						parentIds,
						err
					});
					return fail(400, {
						message: 'One or more selected parent proposals are invalid for this question.'
					});
				}
			}

			let created: { id?: string } | null = null;

			let primaryLabelId: string | undefined = undefined;

			let shouldCreateLabel = false;
			let effectiveLabelStr = '';

			if (parentIds.length === 0) {
				shouldCreateLabel = true;
				effectiveLabelStr = labelStr ? labelStr.trim() : title.trim().substring(0, 40);
			} else if (parentIds.length > 1) {
				shouldCreateLabel = !!labelStr.trim();
				effectiveLabelStr = labelStr.trim();
			}

			if (shouldCreateLabel && effectiveLabelStr) {
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
						console.error(`[proposal:create:${requestId}] Failed to create label`, e);
					}
				}
			}

			try {
				const simulatedAt = formData.get('simulated_at')?.toString();
				const occurredAt = simulatedAt
					? new Date(simulatedAt).toISOString()
					: new Date().toISOString();

				const payload: Record<string, unknown> = {
					question: params.id,
					author: user.id,
					title,
					content,
					reason_for_change: reasonForChangeText,
					parent_proposals: parentIds,
					state: 'Proposed',
					...(simulatedAt ? { occurred_at: occurredAt } : {}),
					...(primaryLabelId ? { primary_label: primaryLabelId, labels: [primaryLabelId] } : {})
				};

				if (parentIds.length === 2) {
					// All combinations start as pending merges
					const sortedParents = [...parentIds].sort();
					const existingFilter = `question = "${escapeFilter(params.id)}" && author = "${escapeFilter(user.id)}" && parent_proposals ~ "${escapeFilter(sortedParents[0])}" && parent_proposals ~ "${escapeFilter(sortedParents[1])}"`;
					try {
						const existing = await locals.pb
							.collection('proposals')
							.getFirstListItem(existingFilter);
						if (existing?.id) {
							return { success: true, id: existing.id };
						}
					} catch {
						// No existing record — proceed with creation
					}
				}

				// Base parent: anchor for lineage and diff base
				if (baseParent) {
					payload.base_parent = baseParent;
				} else if (parentIds.length === 2) {
					// Fallback to first parent if base parent is not provided
					payload.base_parent = parentIds[0];
				}

				created = await locals.pb.collection('proposals').create(payload);

				let actionType = 'create_idea';
				if (parentIds.length === 1) actionType = 'remix_singular';
				else if (parentIds.length >= 2) actionType = 'remix_combine';

				if (created?.id) {
					const logPromises: Promise<unknown>[] = [
						locals.pb
							.collection('action_logs')
							.create({
								question: params.id,
								user: user.id,
								action_type: actionType,
								target_id: created.id,
								occurred_at: occurredAt
							}, { requestKey: null })
							.catch((e) => console.error('[action_logs] failed to log creation', e))
					];

					if (shouldCreateLabel && effectiveLabelStr && primaryLabelId) {
						logPromises.push(
							locals.pb
								.collection('action_logs')
								.create({
									question: params.id,
									user: user.id,
									action_type: 'create_label',
									target_id: primaryLabelId,
									metadata_json: { label_name: effectiveLabelStr },
									occurred_at: occurredAt
								}, { requestKey: null })
								.catch((e) => console.error('[action_logs] failed to log label creation', e))
						);
					}
					await Promise.all(logPromises);
				}
			} catch (err) {
				console.error(`[proposal:create:${requestId}] pocketbase create failed`, err);
				return fail(400, {
					message: getPocketBaseErrorMessage(err, 'Failed to publish proposal.')
				});
			}

			if (!created?.id) {
				console.error(`[proposal:create:${requestId}] create returned no id`, { created });
				return fail(400, { message: 'Failed to publish proposal.' });
			}

			// Return JSON with the new proposal ID for fetch-based callers (EditorSheet)
			return { success: true, id: created.id };
		} catch (e: any) {
			console.error('FATAL ERROR IN ACTION', e);
			return fail(500, { message: e.message || String(e), stack: e.stack });
		}
	}
};
