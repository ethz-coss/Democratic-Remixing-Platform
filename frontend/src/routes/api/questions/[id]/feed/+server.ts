import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sortProposals, filterProposals } from '$lib/services/feed-filter';

export const POST: RequestHandler = async ({ request, locals, params }) => {
	try {
		const body = await request.json();
		const { mode = 'PersonalFocus', opts = {} } = body;
		const questionId = params.id;

		if (!questionId) {
			return json({ error: 'Missing question ID' }, { status: 400 });
		}

		// Fetch all proposals for this question
		const proposals = (await locals.pb.collection('proposals').getFullList({
			filter: `question = "${questionId}"`
		})) as unknown as App.ProposalRecord[];

		// Hydrate opts from raw JSON structures
		const parsedOpts: any = {
			searchQuery: '',
			onlySupported: false,
			onlyAuthored: false,
			onlyInFocus: false,
			onlyChampions: false,
			onlyCombinations: false,
			onlyImprovements: false,
			onlyUnseen: false,
			onlyHidden: false,
			userId: null,
			championIds: new Set(),
			...opts,
			seenProposalIds: opts.seenProposalIds ? new Set(opts.seenProposalIds) : new Set(),
			labelAffinities: opts.labelAffinities
				? Array.isArray(opts.labelAffinities)
					? new Map(opts.labelAffinities)
					: typeof opts.labelAffinities === 'object'
						? new Map(Object.entries(opts.labelAffinities))
						: new Map()
				: new Map(),
			userVotes: opts.userVotes || {}
		};

		// Option to filter first (e.g. onlyImprovements, onlySupported)
		let filteredSols = proposals;

		// Map some boolean flags if the simulation requested specific feed tabs
		if (opts.onlyImprovements) {
			filteredSols = filterProposals(proposals, new Set(), {
				...parsedOpts,
				onlyImprovements: true
			});
		} else if (opts.onlySupported) {
			filteredSols = filterProposals(proposals, new Set(), { ...parsedOpts, onlySupported: true });
		}

		// Inject mock view counts if provided (useful for simulations)
		if (opts.proposalViewCounts) {
			for (const sol of filteredSols) {
				(sol as any).unique_viewer_count = opts.proposalViewCounts[sol.id] || 0;
			}
		}

		// Sort proposals
		const sortedSols = sortProposals([...filteredSols], mode, parsedOpts);

		// Return array of IDs to save bandwidth, since simulation just needs the ordered list
		return json({ success: true, proposalIds: sortedSols.map((s) => s.id) });
	} catch (err) {
		console.error(
			'[api/questions/feed] failed to generate feed',
			err instanceof Error ? err.stack || err.message : err
		);
		return json({ error: 'Failed to generate feed' }, { status: 500 });
	}
};
