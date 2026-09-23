export type NodeRelationType =
	| 'self'
	| 'source'
	| 'iteration'
	| 'topic-peer'
	| 'earlier'
	| 'further';

export interface NeighborhoodResult {
	nodes: App.ProposalRecord[];
	nodeTypes: Map<string, NodeRelationType>;
	hiddenSiblingCount: number;
}

export function computeLocalNeighborhood(
	focusId: string,
	allProposals: App.ProposalRecord[],
	options?: { cap?: number }
): NeighborhoodResult {
	const cap = options?.cap ?? 12;

	const focusNode = allProposals.find((p) => p.id === focusId);
	if (!focusNode) {
		return {
			nodes: [],
			nodeTypes: new Map(),
			hiddenSiblingCount: 0
		};
	}

	const nodeTypes = new Map<string, NodeRelationType>();
	nodeTypes.set(focusId, 'self');

	const nodesMap = new Map<string, App.ProposalRecord>();
	nodesMap.set(focusId, focusNode);

	const proposalMap = new Map<string, App.ProposalRecord>();
	for (const p of allProposals) {
		proposalMap.set(p.id, p);
	}

	// 1. Traverse upwards to include the FULL ancestor chain to guarantee structural consistency
	const ancestors = new Set<string>();
	const queue = [focusId];
	while (queue.length > 0) {
		const curr = queue.shift()!;
		const node = proposalMap.get(curr);
		if (node && node.parent_proposals) {
			for (const pId of node.parent_proposals) {
				if (!ancestors.has(pId)) {
					ancestors.add(pId);
					queue.push(pId);
				}
			}
		}
	}

	for (const pId of ancestors) {
		const p = proposalMap.get(pId);
		if (p) {
			nodesMap.set(p.id, p);
			if (focusNode.parent_proposals?.includes(p.id)) {
				nodeTypes.set(p.id, 'source');
			} else {
				nodeTypes.set(p.id, 'earlier');
			}
		}
	}

	// 2. Include all direct children (iterations)
	const children: App.ProposalRecord[] = [];
	for (const p of allProposals) {
		if (p.parent_proposals && p.parent_proposals.includes(focusId)) {
			children.push(p);
		}
	}
	for (const p of children) {
		nodesMap.set(p.id, p);
		nodeTypes.set(p.id, 'iteration');
	}

	// 3. Include grandchildren (further iterations) if capacity allows
	const grandchildren: App.ProposalRecord[] = [];
	for (const p of allProposals) {
		if (!nodesMap.has(p.id) && p.id !== focusId) {
			const isGrandchild = children.some((c) => p.parent_proposals?.includes(c.id));
			if (isGrandchild) {
				grandchildren.push(p);
			}
		}
	}
	grandchildren.sort((a, b) => (b.subscription_count || 0) - (a.subscription_count || 0));

	for (const p of grandchildren) {
		if (nodesMap.size < cap) {
			nodesMap.set(p.id, p);
			nodeTypes.set(p.id, 'further');
		}
	}

	// 4. Include topical siblings if capacity allows
	const siblings: App.ProposalRecord[] = [];
	let totalSiblingCount = 0;

	const focusLabels = focusNode.labels ?? [];
	const focusPrimaryLabel = focusNode.primary_label;

	if (focusLabels.length > 0) {
		const potentialSiblings = allProposals.filter(
			(p) =>
				p.id !== focusId && !nodesMap.has(p.id) && p.labels?.some((l) => focusLabels.includes(l))
		);

		totalSiblingCount = potentialSiblings.length;

		// Sort: primary match first, then shared count desc, then subscription_count desc
		potentialSiblings.sort((a, b) => {
			const aHasPrimary = a.labels?.includes(focusPrimaryLabel) ? 1 : 0;
			const bHasPrimary = b.labels?.includes(focusPrimaryLabel) ? 1 : 0;
			if (aHasPrimary !== bHasPrimary) return bHasPrimary - aHasPrimary;

			const aShared = a.labels?.filter((l) => focusLabels.includes(l)).length || 0;
			const bShared = b.labels?.filter((l) => focusLabels.includes(l)).length || 0;
			if (aShared !== bShared) return bShared - aShared;

			return (b.subscription_count || 0) - (a.subscription_count || 0);
		});

		for (const p of potentialSiblings) {
			siblings.push(p);
		}
	}

	for (const p of siblings) {
		if (nodesMap.size < cap) {
			nodesMap.set(p.id, p);
			nodeTypes.set(p.id, 'topic-peer');
		}
	}

	let hiddenSiblingCount = totalSiblingCount - siblings.filter((p) => nodesMap.has(p.id)).length;
	if (hiddenSiblingCount < 0) hiddenSiblingCount = 0;

	const sortedNodes = Array.from(nodesMap.values()).sort((a, b) => {
		// Sort deterministically to ensure stable dagre layout
		if (a.created && b.created) {
			const timeDiff = new Date(a.created).getTime() - new Date(b.created).getTime();
			if (timeDiff !== 0) return timeDiff;
		}
		return a.id.localeCompare(b.id);
	});

	return {
		nodes: sortedNodes,
		nodeTypes,
		hiddenSiblingCount
	};
}
