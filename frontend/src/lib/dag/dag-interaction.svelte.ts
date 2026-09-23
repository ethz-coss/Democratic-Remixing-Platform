/**
 * dag-interaction.svelte.ts — Rune-based module encapsulating DAG graph filtering,
 * node interaction state, and ancestry trail utilities.
 *
 * Extracted from +layout.svelte to keep the layout thin.
 */
import { goto } from '$app/navigation';

import { editorState } from '$lib/editor.svelte';
import { feedViewState, getFilterState } from '$lib/feedView.svelte';
import { getFuzzyMatchIds } from '$lib/services/feed-filter';
import { page } from '$app/state';

export type TabRoute =
	| 'ballot'
	| 'ideas'
	| 'themes'
	| 'question'
	| 'editor'
	| 'proposal'
	| 'compare';

/**
 * Determine the cluster ID for a proposal. Uses root_proposal if set,
 * otherwise falls back to the proposal's own ID (it is a root).
 */
function getClusterId(sol: App.ProposalRecord): string {
	return sol.root_proposal || sol.id;
}

/**
 * Walk ancestors up from a proposal ID, collecting all ancestor IDs (Unbounded).
 */
function walkUp(id: string, solMap: Map<string, App.ProposalRecord>, relevant: Set<string>) {
	const sol = solMap.get(id);
	if (!sol) return;
	for (const pid of sol.parent_proposals ?? []) {
		if (!relevant.has(pid)) {
			relevant.add(pid);
			walkUp(pid, solMap, relevant);
		}
	}
}

/**
 * Walk descendants down from a proposal ID, collecting all descendant IDs (Unbounded).
 */
function walkDown(
	id: string,
	childrenMap: Map<string, App.ProposalRecord[]>,
	relevant: Set<string>
) {
	const children = childrenMap.get(id) || [];
	for (const child of children) {
		if (!relevant.has(child.id)) {
			relevant.add(child.id);
			walkDown(child.id, childrenMap, relevant);
		}
	}
}

/**
 * Build the set of relevant IDs for a focused proposal:
 * - All ancestors
 * - All descendants
 * - For combinations in the set, both (all) immediate parents
 */
function getProposalLineage(
	activeProposalId: string,
	allProposals: App.ProposalRecord[],
	includeBoundaryParents: boolean = true
): Set<string> {
	const solMap = new Map(allProposals.map((s) => [s.id, s]));
	const relevantIds = new Set<string>();

	const focusSol = solMap.get(activeProposalId);
	if (!focusSol) return relevantIds;

	relevantIds.add(activeProposalId);

	const childrenMap = new Map<string, App.ProposalRecord[]>();
	for (const s of allProposals) {
		for (const pid of s.parent_proposals ?? []) {
			if (!childrenMap.has(pid)) childrenMap.set(pid, []);
			childrenMap.get(pid)!.push(s);
		}
	}

	// 1. All ancestors
	walkUp(activeProposalId, solMap, relevantIds);

	// 2. All descendants
	walkDown(activeProposalId, childrenMap, relevantIds);

	// 3. For combinations, both immediate parents
	// (Ancestors already include their parents, so this primarily adds the "other" parents of descendants)
	if (includeBoundaryParents) {
		const boundaryIds = new Set<string>();
		for (const rid of relevantIds) {
			const sol = solMap.get(rid);
			if (!sol) continue;

			if ((sol.parent_proposals?.length ?? 0) > 1) {
				for (const pid of sol.parent_proposals!) {
					if (!relevantIds.has(pid) && solMap.has(pid)) {
						boundaryIds.add(pid);
					}
				}
			}
		}

		for (const bid of boundaryIds) {
			relevantIds.add(bid);
		}
	}

	return relevantIds;
}

/**
 * Filter proposals for the DAG based on the current tab/context.
 */
export function filterDagProposals(
	allSols: App.ProposalRecord[],
	currentTab: TabRoute,
	activeProposalId: string | null,
	userProposalVotes: Record<string, number>,
	currentUserId?: string | null,
	seenProposalIds?: Set<string>,
	labels?: App.LabelRecord[],
	activeThemeKey?: string | null,
	graphViewMode: 'auto' | 'full' | 'clusters' | 'lineage' = 'auto'
): App.ProposalRecord[] {
	if (graphViewMode === 'full' || graphViewMode === 'clusters') {
		return allSols;
	}

	const solMap = new Map(allSols.map((s) => [s.id, s]));

	// ── Compare page and Combine view filter: path-based connection ───────────
	if (graphViewMode === 'auto' && (currentTab === 'compare' || editorState.phase === 'combine')) {
		const baseId =
			currentTab === 'compare' ? page.url.searchParams.get('base') : editorState.parentA?.id;
		const otherId =
			currentTab === 'compare' ? page.url.searchParams.get('other') : editorState.parentB?.id;
		if (baseId && otherId) {
			const solMap = new Map(allSols.map((s) => [s.id, s]));

			const ancBase = new Set<string>();
			ancBase.add(baseId);
			walkUp(baseId, solMap, ancBase);

			const ancOther = new Set<string>();
			ancOther.add(otherId);
			walkUp(otherId, solMap, ancOther);

			const commonAnc = new Set([...ancBase].filter((x) => ancOther.has(x)));
			const relevantIds = new Set<string>();
			relevantIds.add(baseId);
			relevantIds.add(otherId);

			const childrenMap = new Map<string, App.ProposalRecord[]>();
			for (const s of allSols) {
				for (const pid of s.parent_proposals ?? []) {
					if (!childrenMap.has(pid)) childrenMap.set(pid, []);
					childrenMap.get(pid)!.push(s);
				}
			}

			if (commonAnc.size > 0) {
				// Find Lowest Common Ancestors (LCA)
				const lcas = new Set<string>();
				for (const ca of commonAnc) {
					const children = childrenMap.get(ca) || [];
					const hasCommonAncChild = children.some((c) => commonAnc.has(c.id));
					if (!hasCommonAncChild) lcas.add(ca);
				}

				// For each LCA, add nodes on paths down to base and other
				for (const lca of lcas) {
					const descLca = new Set<string>();
					descLca.add(lca);
					walkDown(lca, childrenMap, descLca);

					for (const id of ancBase) {
						if (descLca.has(id)) relevantIds.add(id);
					}
					for (const id of ancOther) {
						if (descLca.has(id)) relevantIds.add(id);
					}
				}
			} else {
				// No common ancestors: show paths from their respective roots
				const baseSol = solMap.get(baseId);
				const otherSol = solMap.get(otherId);
				const rootBase = baseSol?.root_proposal || baseId;
				const rootOther = otherSol?.root_proposal || otherId;

				const descRootBase = new Set<string>();
				descRootBase.add(rootBase);
				walkDown(rootBase, childrenMap, descRootBase);
				for (const id of ancBase) {
					if (descRootBase.has(id)) relevantIds.add(id);
				}

				const descRootOther = new Set<string>();
				descRootOther.add(rootOther);
				walkDown(rootOther, childrenMap, descRootOther);
				for (const id of ancOther) {
					if (descRootOther.has(id)) relevantIds.add(id);
				}
			}

			return allSols.filter((s) => relevantIds.has(s.id));
		}
	}

	// ── Proposal detail / Editor filter ────────────
	// If the user has a specific proposal detail open, or has forced lineage view, show the lineage graph
	if (
		(graphViewMode === 'auto' && activeProposalId) ||
		(graphViewMode === 'lineage' && activeProposalId)
	) {
		const lineage = getProposalLineage(activeProposalId, allSols);
		return allSols.filter((s) => lineage.has(s.id));
	}

	if (graphViewMode === 'auto' && editorState.isOpen) {
		const relevant = new Set<string>();
		if (editorState.parentA) {
			const lineageA = getProposalLineage(editorState.parentA.id, allSols);
			for (const id of lineageA) relevant.add(id);
		}
		if (editorState.parentB) {
			const lineageB = getProposalLineage(editorState.parentB.id, allSols);
			for (const id of lineageB) relevant.add(id);
		}
		if (relevant.size > 0) {
			return allSols.filter((s) => relevant.has(s.id));
		}
	}

	// ── Feed sub-view filter: Focus/All/Map with optional filters ──────────────
	if (
		graphViewMode === 'auto' &&
		(currentTab === 'ballot' || currentTab === 'ideas' || currentTab === 'themes')
	) {
		const relevant = new Set<string>();
		if (currentTab === 'ballot') {
			// Ballot: show only in_focus proposals + their ancestors (no chip filters)
			for (const s of allSols) {
				if (s.in_focus) {
					relevant.add(s.id);
					walkUp(s.id, solMap, relevant);
				}
			}
			return allSols.filter((s) => relevant.has(s.id));
		}

		// 'themes' detail view: only the active theme's cluster + immediate parents
		if (currentTab === 'themes' && activeThemeKey) {
			const relevantTheme = new Set<string>();
			for (const s of allSols) {
				if (s.primary_label === activeThemeKey) {
					relevantTheme.add(s.id);
				}
			}
			const themeMembers = [...relevantTheme];
			for (const id of themeMembers) {
				const sol = solMap.get(id);
				if (sol?.parent_proposals) {
					for (const pid of sol.parent_proposals) {
						if (solMap.has(pid)) relevantTheme.add(pid);
					}
				}
			}
			return allSols.filter((s) => relevantTheme.has(s.id));
		}

		// 'ideas' or 'themes' (list): apply all active chip filters + search
		const fState = getFilterState('discover');
		const hasChipFilter =
			(fState.onlySupported && userProposalVotes) ||
			(fState.onlyAuthored && currentUserId) ||
			fState.onlyInFocus ||
			fState.onlyChampions ||
			fState.onlyCombinations ||
			fState.onlyImprovements ||
			fState.onlyUnseen ||
			feedViewState.selectedClusterIdx !== null;

		// Build fuzzy match set if search is active
		const searchQuery = fState.searchQuery;
		const fuzzyMatchIds = getFuzzyMatchIds(allSols, searchQuery);

		if (hasChipFilter || fuzzyMatchIds !== null) {
			for (const s of allSols) {
				// Search filter
				if (fuzzyMatchIds !== null && !fuzzyMatchIds.has(s.id)) continue;
				// Chip filters
				const matchesSupport = !fState.onlySupported || (userProposalVotes[s.id] ?? 0) > 0;
				const matchesAuthored =
					!fState.onlyAuthored || (currentUserId && s.author === currentUserId);
				const matchesInFocus = !fState.onlyInFocus || s.in_focus;
				const matchesChampion = !fState.onlyChampions || feedViewState.championIds.has(s.id);
				const parentCount = s.parent_proposals?.length ?? 0;
				const matchesType =
					(!fState.onlyCombinations || parentCount >= 2) &&
					(!fState.onlyImprovements || parentCount === 1);
				const matchesUnseen = !fState.onlyUnseen || (seenProposalIds && !seenProposalIds.has(s.id));
				const matchesComparePool = true;

				let matchesCluster = true;
				if (feedViewState.selectedClusterIdx !== null && labels) {
					const targetLabel = labels[feedViewState.selectedClusterIdx];
					if (targetLabel) {
						matchesCluster = s.primary_label === targetLabel.id;
					}
				}

				if (
					matchesSupport &&
					matchesAuthored &&
					matchesInFocus &&
					matchesChampion &&
					matchesType &&
					matchesUnseen &&
					matchesComparePool &&
					matchesCluster
				) {
					relevant.add(s.id);
					walkUp(s.id, solMap, relevant);
				}
			}
			if (relevant.size === 0) return [];
			return allSols.filter((s) => relevant.has(s.id));
		}
	}

	return allSols;
}

/**
 * Handle node tap on the DAG — navigate or scroll to proposal card.
 */
export function handleNodeTap(
	ideaId: string,
	questionId: string,
	currentTab: TabRoute,
	setShowMap: (v: boolean) => void,
	setSnapPoint: (v: number) => void,
	setFocusId: (v: string) => void
) {
	setShowMap(true);
	setSnapPoint(0.5);

	if (currentTab === 'proposal') {
		// Stay on the same page. Expansion is handled by SvelteFlow / custom events.
	} else {
		setTimeout(() => {
			const card = document.getElementById(`idea-card-${ideaId}`);
			if (card) {
				card.scrollIntoView({ behavior: 'smooth', block: 'center' });
				card.style.transition = 'box-shadow 0.3s, border-color 0.3s';
				card.style.boxShadow = '0 0 0 4px var(--color-primary)';
				card.style.borderColor = 'var(--color-primary)';
				setTimeout(() => {
					card.style.boxShadow = '';
					card.style.borderColor = '';
				}, 1500);
			}
		}, 50);
	}
}

// ── Ancestry trail utilities ───────────────────────────────────────

/** Metadata about a cluster (title group) that appears in the subgraph */
interface SubgraphClusterInfo {
	/** root_proposal ID used as the cluster key */
	clusterId: string;
	/** Display title for the cluster bounding box.
	 *  Uses accepted merge title when merge_status === 'accepted',
	 *  otherwise falls back to the root proposal's title. */
	title: string;
	/** Node IDs from this cluster that are included in the subgraph */
	visibleMemberIds: string[];
	/** Total number of proposals in this cluster across the full question */
	totalMemberCount: number;
	/** Whether this is the cluster containing the focused proposal(s) */
	isFocusCluster: boolean;
	/** The persistent color assigned to this cluster */
	color?: string;
}

interface AncestrySubgraph {
	nodes: App.ProposalRecord[];
	edges: Array<{ source: string; target: string }>;
	/** Maps each node ID → its cluster ID (root_proposal) */
	clusterMembership: Map<string, string>;
	/** The cluster ID of the focused proposal(s) */
	focusClusterId: string;
	/** Metadata for each cluster represented in the subgraph */
	clusters: SubgraphClusterInfo[];
}

/**
 * Determine the display title for a cluster bounding box.
 * If the cluster root has an accepted merge, use that title.
 * Otherwise use the root proposal's title.
 */
function resolveClusterTitle(
	clusterId: string,
	solMap: Map<string, App.ProposalRecord>,
	clusterMembers: App.ProposalRecord[]
): string {
	// Fall back to the root proposal's title
	const rootSol = solMap.get(clusterId);
	if (rootSol?.title) return rootSol.title;

	return clusterMembers[0]?.title || 'Untitled';
}

/**
 * Build a focused subgraph for the AncestryTrail component.
 *
 * Collects:
 * - The full ancestry and descendants of the focus node within its own cluster
 * - 1-hop boundary nodes (immediate parents and children in OTHER clusters)
 *
 * Also computes cluster metadata so the AncestryTrail can render multiple
 * title bounding boxes — one for the focus cluster and sparse neighbor boxes
 * for other clusters whose nodes appear as parents/children.
 */
export function buildAncestrySubgraph(
	focusIds: string[],
	allProposals: App.ProposalRecord[]
): AncestrySubgraph {
	const solMap = new Map(allProposals.map((s) => [s.id, s]));

	// If there are multiple focusIds, we combine their relevant sets
	const relevantIds = new Set<string>();
	for (const fid of focusIds) {
		const lineage = getProposalLineage(fid, allProposals);
		for (const id of lineage) relevantIds.add(id);
	}

	// Filter nodes
	const nodes = allProposals.filter((s) => relevantIds.has(s.id));

	// Build structural edges (only between nodes in the subgraph)
	const edges: Array<{ source: string; target: string }> = [];
	const edgeKeys = new Set<string>();
	for (const s of nodes) {
		for (const pid of s.parent_proposals ?? []) {
			if (relevantIds.has(pid)) {
				const key = `${pid}::${s.id}`;
				if (!edgeKeys.has(key)) {
					edgeKeys.add(key);
					edges.push({ source: pid, target: s.id });
				}
			}
		}
	}

	// ── Compute cluster metadata ────────────────────────────────────

	// Build cluster membership for subgraph nodes
	const clusterMembership = new Map<string, string>();
	for (const s of nodes) {
		clusterMembership.set(s.id, getClusterId(s));
	}

	// Determine focus cluster from focus nodes
	const focusSol = focusIds.length > 0 ? solMap.get(focusIds[0]) : undefined;
	const focusClusterId = focusSol ? getClusterId(focusSol) : '';

	// Count total members per cluster across ALL proposals (for "N of M shown")
	const totalByCluster = new Map<string, number>();
	for (const s of allProposals) {
		const cid = getClusterId(s);
		totalByCluster.set(cid, (totalByCluster.get(cid) ?? 0) + 1);
	}

	// Group subgraph nodes by cluster
	const clusterGroupMap = new Map<string, App.ProposalRecord[]>();
	for (const s of nodes) {
		const cid = getClusterId(s);
		if (!clusterGroupMap.has(cid)) clusterGroupMap.set(cid, []);
		clusterGroupMap.get(cid)!.push(s);
	}

	// Build cluster info array
	const clusters: SubgraphClusterInfo[] = [];
	for (const [cid, members] of clusterGroupMap) {
		clusters.push({
			clusterId: cid,
			title: resolveClusterTitle(cid, solMap, members),
			visibleMemberIds: members.map((s) => s.id),
			totalMemberCount: totalByCluster.get(cid) ?? members.length,
			isFocusCluster: cid === focusClusterId
		});
	}

	// Sort: focus cluster first, then by number of visible members descending
	clusters.sort((a, b) => {
		if (a.isFocusCluster !== b.isFocusCluster) return a.isFocusCluster ? -1 : 1;
		return b.visibleMemberIds.length - a.visibleMemberIds.length;
	});

	return { nodes, edges, clusterMembership, focusClusterId, clusters };
}
