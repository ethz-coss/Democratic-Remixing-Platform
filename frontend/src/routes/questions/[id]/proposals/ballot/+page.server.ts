import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, parent }) => {
	const parentData = await parent();
	const question = parentData.question;

	let hasVoted = false;
	let previousRanks: Array<{ proposalId: string; rank: number }> = [];
	let previousAbstention = false;

	// Get the user's current ballot state (for Voting phase)
	if (locals.user) {
		try {
			const existing = await locals.pb.send('/api/custom/ballot-responses/existing', {
				query: {
					user: locals.user.id,
					question: params.id
				}
			});
			if (existing && existing.id) {
				hasVoted = true;
				previousRanks = existing.ranks || [];
				previousAbstention =
					previousRanks.length === 1 && previousRanks[0].proposalId === 'abstain';
				if (!previousAbstention && Array.isArray(existing.ranks)) {
					previousRanks = existing.ranks;
				}
			}
		} catch (e) {
			// Not found
		}
	}

	return {
		hasVoted,
		previousRanks,
		previousAbstention
	};
};

export const actions: Actions = {
	submitBallot: async ({ request, locals, params }) => {
		if (!locals.user) {
			return fail(401, { error: 'Unauthorized' });
		}

		const questionId = params.id;
		const formData = await request.formData();

		const isAbstention = formData.get('isAbstention') === 'true';
		const ranksJson = formData.get('ranks')?.toString() || '[]';

		let ranks: Array<{ proposalId: string; rank: number }> = [];
		if (!isAbstention) {
			try {
				ranks = JSON.parse(ranksJson);
			} catch (e) {
				return fail(400, { error: 'Invalid ranks data format' });
			}
		}

		// PocketBase v0.23 does not allow empty arrays for 'required: true' JSON fields.
		// If the user abstained, or there are zero proposals to rank, we insert a dummy array.
		if (ranks.length === 0 || isAbstention) {
			ranks = [{ proposalId: 'abstain', rank: 0 }];
		}

		let isUpdate = false;
		try {
			// Find if user already voted (use custom backend route to bypass listRule null)
			let existingId: string | null = null;
			try {
				const existing = await locals.pb.send('/api/custom/ballot-responses/existing', {
					query: {
						user: locals.user.id,
						question: questionId
					}
				});
				if (existing && existing.id) {
					existingId = existing.id;
				}
			} catch (e) {
				// Not found
			}

			const payload = {
				user: locals.user.id,
				question: questionId,
				ranks: ranks
			};

			if (existingId) {
				isUpdate = true;
				await locals.pb.collection('ballot_responses').update(existingId, payload);
			} else {
				try {
					await locals.pb.collection('ballot_responses').create(payload);
				} catch (createErr: any) {
					// Check for unique constraint violation (race condition from double submissions)
					if (
						createErr.status === 400 &&
						createErr.response?.data?.user &&
						createErr.response?.data?.question
					) {
						console.error(
							'UNIQUE CONSTRAINT OR VALIDATION ERROR DETECTED:',
							JSON.stringify(createErr.response.data, null, 2)
						);
						// Refetch the ID now that it exists
						let reFetched;
						try {
							reFetched = await locals.pb.send('/api/custom/ballot-responses/existing', {
								query: { user: locals.user.id, question: questionId }
							});
						} catch (reFetchErr) {
							console.error('REFETCH FAILED:', reFetchErr);
							throw createErr; // throw original to avoid 404 masking it
						}

						if (reFetched && reFetched.id) {
							isUpdate = true;
							await locals.pb.collection('ballot_responses').update(reFetched.id, payload);
						} else {
							throw createErr;
						}
					} else {
						throw createErr;
					}
				}
			}
		} catch (err: any) {
			console.error('Failed to submit ballot:', err);
			return fail(500, { error: 'Failed to submit ballot' });
		}

		const ballotActionType = isAbstention ? 'ballot_abstain' : 'ballot_submit';
		await locals.pb
			.collection('action_logs')
			.create({
				question: questionId,
				user: locals.user.id,
				action_type: ballotActionType,
				metadata_json: { ranks_count: ranks.length, is_update: isUpdate },
				occurred_at: new Date().toISOString()
			})
			.catch((e) => console.error('[action_logs] failed to log ballot', e));

		return { success: true, isUpdate };
	},
	cancelAbstention: async ({ locals, params }) => {
		if (!locals.user) {
			return fail(401, { error: 'Unauthorized' });
		}
		const questionId = params.id;

		try {
			const existing = await locals.pb.send('/api/custom/ballot-responses/existing', {
				query: {
					user: locals.user.id,
					question: questionId
				}
			});

			if (existing && existing.id) {
				await locals.pb.collection('ballot_responses').delete(existing.id);
			}

			await locals.pb
				.collection('action_logs')
				.create({
					question: questionId,
					user: locals.user.id,
					action_type: 'ballot_abstain_cancel',
					metadata_json: {},
					occurred_at: new Date().toISOString()
				})
				.catch((e) => console.error('[action_logs] failed to log ballot cancel', e));
		} catch (err: any) {
			console.error('Failed to cancel abstention:', err);
			return fail(500, { error: 'Failed to cancel abstention' });
		}

		return { success: true, canceledAbstention: true };
	}
};
