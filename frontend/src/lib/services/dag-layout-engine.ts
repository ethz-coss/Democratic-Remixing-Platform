/**
 * DAG Layout Engine
 *
 * Uses @dagrejs/dagre to compute a deterministic top-to-bottom DAG layout
 * from the proposal parentage graph. Contradiction edges are excluded from
 * layout and returned as visual-only overlays.
 *
 * Key rules (from the concept doc):
 * - Rank 0 = root ideas (empty parent_proposals)
 * - Children strictly below parents
 * - Remix edges (1 parent) get high weight → tight vertical silos
 * - Synthesis edges (2+ parents) get low weight → spread horizontally
 * - Contradiction edges are NOT fed to dagre
 *
 * Post-layout: evaluates Connection Axioms to compute equivalence class
 * clusters, sever points, and merge points for DAG visualization.
 */

import dagre from '@dagrejs/dagre';
interface AxiomCluster {
	id: string;
	memberIds: string[];
	championId: string;
	title: string;
	stableKey: string;
	color?: string;
	totalMemberCount?: number;
}
interface SeverPoint {
	id: string;
}
interface MergePoint {
	id: string;
}

// ── Types ────────────────────────────────────────────────────────────────

export interface DagNode {
	id: string;
	/** Absolute center X in graph space */
	x: number;
	/** Absolute center Y in graph space */
	y: number;
	/** Node width */
	width: number;
	/** Node height */
	height: number;
	proposal: App.ProposalRecord;
	kind: 'root' | 'remix' | 'synthesis';
	inArena: boolean;
	isChampion: boolean;
	userVote: number; // 0 = neutral, >0 = support, <0 = oppose
	/** True when this is a cluster group node rendered as a collapsed card */
	isCompound: boolean;
	/** Number of ideas in this cluster (group nodes only) */
	clusterMemberCount: number;
	/** Total number of variants in this cluster across the entire question */
	clusterTotalMemberCount?: number;
	/** Display title of the cluster (group nodes only) */
	clusterTitle: string;
	/** Cluster index for color lookup */
	clusterIndex: number;
	/** True when this node is the cluster group node (type: clusterGroup) */
	isGroupNode?: boolean;
	/** Set on child proposal nodes — parent group node ID */
	parentId?: string;
}

export interface DagEdge {
	id: string;
	source: string;
	target: string;
	type: 'structural' | 'contradiction';
	label: string;
	/** dagre edge weight (only relevant for structural) */
	weight: number;
	/** Intermediate proposals skipped by contraction */
	contractedPath?: App.ProposalRecord[];
	/** Number of original edges merged into this remapped edge (for feed view thickness) */
	mergeCount?: number;
	/** True when this edge connects two collapsed cluster proxies (feed DAG) */
	isClusterEdge?: boolean;
	/** Cluster color for inter-cluster bridge edges (pre-computed from stableKey) */
	clusterColor?: string;
	/** Optional pre-computed routing points for static rendering */
	points?: { x: number; y: number }[];
}

interface DagLayout {
	nodes: DagNode[];
	structuralEdges: DagEdge[];
	contradictionEdges: DagEdge[];
	/** Equivalence class clusters of Arena nodes */
	clusters: AxiomCluster[];
	/** LCA nodes where contradictions severed the tree */
	severPoints: SeverPoint[];
	/** Synthesis Arena nodes that healed otherwise-severed paths */
	mergePoints: MergePoint[];
	/** Node IDs in the active lineage path(s) — empty when no focus */
	lineageNodeIds: Set<string>;
	/** Edge IDs in the active lineage path(s) — empty when no focus */
	lineageEdgeIds: Set<string>;
	/** Map from proposal ID to stable cluster key for ALL proposals (active or not) */
	fullClusterMap: Map<string, string>;
}

// Re-export types for consumers

// Re-export for consumers
const CLUSTER_COLORS = [
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
function getClusterColor(idx: number) {
	return CLUSTER_COLORS[idx % CLUSTER_COLORS.length];
}

// ── Constants ────────────────────────────────────────────────────────────

/** Reserved node bounding box — dagre spaces the graph assuming every node
 *  occupies this rectangle. Actual rendering may show a 20px dot inside. */
const NODE_WIDTH = 150;
const NODE_HEIGHT = 40;

/** Compact dot-mode dimensions — used in overview (feed) tab */
const DOT_NODE_WIDTH = 120;
const DOT_NODE_HEIGHT = 100;

/** Expanded node dimensions — larger so dagre pushes neighbors away */
const EXPANDED_NODE_WIDTH = 260;
const EXPANDED_NODE_HEIGHT = 140;

/** High weight keeps single-parent edges in tight vertical columns. */
const REMIX_EDGE_WEIGHT = 10;

/** Low weight lets dagre place synthesis nodes between their parents. */
const SYNTHESIS_EDGE_WEIGHT = 2;

/** Expanded cluster minimum width — prevents collapsing when a cluster has few dots */
const EXPANDED_CLUSTER_MIN_WIDTH = 260;

/** Expanded cluster header height — used to calculate child offset and vertical clearance */
const EXPANDED_CLUSTER_HEADER_H = 28;

/** Extra top clearance spacing below the header/title for the dots and cards within */
const EXPANDED_CLUSTER_TOP_CLEARANCE = 12;

// ── Main entry point ─────────────────────────────────────────────────────

export function computeDagLayout(
	activeProposals: App.ProposalRecord[],
	allProposals: App.ProposalRecord[],

	userVotes: Record<string, number>,
	activeTab: string = 'feed',
	expandedClusters: Set<string> = new Set(),
	expandedNodeIds: Set<string> = new Set(),
	/** Optional pre-computed cluster map: proposalId → primary_label (stableKey).
	 *  When provided and covering all proposals, skips evaluateAxioms(). */
	clusterMap?: Map<string, string>,
	question?: App.QuestionRecord,
	/** When true, non-expanded nodes use compact dot dimensions (40×40) */
	dotMode: boolean = false,
	/** Optional pre-computed map of stableKey (label ID) to color string */
	clusterColors?: Map<string, string>
): DagLayout {
	if (activeProposals.length === 0) {
		return {
			nodes: [],
			structuralEdges: [],
			contradictionEdges: [],
			clusters: [],
			severPoints: [],
			mergePoints: [],
			lineageNodeIds: new Set<string>(),
			lineageEdgeIds: new Set<string>(),
			fullClusterMap: new Map<string, string>()
		};
	}

	const proposalMap = new Map<string, App.ProposalRecord>();
	for (const s of allProposals) {
		proposalMap.set(s.id, s);
	}

	// ── 1. Classify nodes ──────────────────────────────────────────────

	const activeProposalMap = new Map<string, App.ProposalRecord>();
	for (const s of activeProposals) {
		activeProposalMap.set(s.id, s);
	}

	const dagNodes: DagNode[] = activeProposals.map((s) => {
		const parentCount = s.parent_proposals?.length ?? 0;
		let kind: DagNode['kind'];
		if (parentCount === 0) {
			kind = 'root';
		} else if (parentCount === 1) {
			kind = 'remix';
		} else {
			kind = 'synthesis';
		}

		return {
			id: s.id,
			x: 0,
			y: 0,
			width: NODE_WIDTH,
			height: NODE_HEIGHT,
			proposal: s,
			kind,
			inArena: s.in_focus,
			isChampion: s.is_champion,
			userVote: userVotes[s.id] ?? 0,
			isCompound: false,
			clusterMemberCount: 0,
			clusterTitle: '',
			clusterIndex: -1
		};
	});

	// ── 2. Build structural edges ──────────────────────────────────────

	const structuralEdges: DagEdge[] = [];
	const edgeKeys = new Set<string>();

	for (const s of activeProposals) {
		if (!s.parent_proposals || s.parent_proposals.length === 0) continue;

		const isMultiParent = s.parent_proposals.length > 1;
		const weight = isMultiParent ? SYNTHESIS_EDGE_WEIGHT : REMIX_EDGE_WEIGHT;

		interface QueueItem {
			id: string;
			path: App.ProposalRecord[];
		}

		const queue: QueueItem[] = [];
		const visited = new Set<string>();

		for (const pId of s.parent_proposals) {
			if (proposalMap.has(pId)) {
				queue.push({ id: pId, path: [proposalMap.get(pId)!] });
				visited.add(pId);
			}
		}

		while (queue.length > 0) {
			const { id: currId, path } = queue.shift()!;

			if (activeProposalMap.has(currId)) {
				// Found closest active ancestor
				const key = `${currId}::${s.id}`;
				if (!edgeKeys.has(key)) {
					edgeKeys.add(key);

					// The path traversed upwards: [parent_of_s, ..., currId]
					// Intermediate nodes are everything except currId (which is the source)
					// We reverse it so it goes from top to bottom
					const intermediateNodes = path.slice(0, path.length - 1).reverse();

					structuralEdges.push({
						id: key,
						source: currId,
						target: s.id,
						type: 'structural',
						label: intermediateNodes.length === 0 ? s.reason_for_change || '' : 'Contracted Path',
						weight,
						contractedPath: intermediateNodes.length > 0 ? intermediateNodes : undefined
					});
				}
			} else {
				// Current node is not active, traverse its parents
				const currNode = proposalMap.get(currId);
				if (currNode && currNode.parent_proposals) {
					for (const pId of currNode.parent_proposals) {
						if (!visited.has(pId) && proposalMap.has(pId)) {
							visited.add(pId);
							queue.push({ id: pId, path: [...path, proposalMap.get(pId)!] });
						}
					}
				}
			}
		}
	}

	// ── 2b. Track synthesis targets for edge styling ─────────────────
	// (Merge dots removed — parent edges converge directly at the target node.)

	const synthEdgeMap = new Map<string, DagEdge[]>(); // target → edges
	for (const e of structuralEdges) {
		if (!synthEdgeMap.has(e.target)) synthEdgeMap.set(e.target, []);
		synthEdgeMap.get(e.target)!.push(e);
	}

	// Mark synthesis edges so the edge component can style them with merge color
	for (const [_targetId, inEdges] of synthEdgeMap) {
		if (inEdges.length < 2) continue;
		for (const e of inEdges) {
			if (!e.label) e.label = '';
		}
	}

	// ── 2c. Pre-compute clusters BEFORE dagre ─────────────────────────
	// Cluster membership only depends on proposal parentage, not layout.
	// Computing early lets us use dagre's compound graph to keep cluster
	// members spatially grouped, preventing bounding-box overlaps.

	// Determine if we can use the provided clusterMap (all proposals must be covered)
	const usePersistedClusters =
		clusterMap && clusterMap.size > 0 && allProposals.every((s) => clusterMap.has(s.id));

	// ── 2d. Optional Unclustered Fallback ─────────────────────────────
	// If no cluster map is provided (e.g. for StaticLineageGraph), we can just
	// lay out the dagNodes directly without any clustering overhead.
	if (!usePersistedClusters) {
		const g = new dagre.graphlib.Graph({ compound: false });
		g.setGraph({
			rankdir: 'LR',
			nodesep: dotMode ? 38 : 50,
			ranksep: dotMode ? 55 : 70
		});
		g.setDefaultEdgeLabel(() => ({}));

		for (const n of dagNodes) {
			g.setNode(n.id, {
				width: dotMode ? DOT_NODE_WIDTH : NODE_WIDTH,
				height: dotMode ? DOT_NODE_HEIGHT : NODE_HEIGHT
			});
		}
		for (const e of structuralEdges) {
			g.setEdge(e.source, e.target);
		}
		dagre.layout(g);

		// Override Dagre's crossing-minimization vertical sorting with a deterministic sort
		// 0. Store original Y coordinates to compute edge shift later
		const oldY = new Map<string, number>();
		for (const n of dagNodes) {
			const ln = g.node(n.id);
			if (ln) oldY.set(n.id, ln.y);
		}

		// 1. Group nodes by their assigned X coordinate (rank)
		const nodesByX = new Map<number, string[]>();
		for (const n of dagNodes) {
			const ln = g.node(n.id);
			if (ln) {
				const rx = Math.round(ln.x); // Dagre uses precise floats, round to group columns
				if (!nodesByX.has(rx)) nodesByX.set(rx, []);
				nodesByX.get(rx)!.push(n.id);
			}
		}

		// 2. Sort each column and re-assign Y coordinates
		for (const [_x, ids] of nodesByX) {
			if (ids.length <= 1) continue;

			// Extract the set of Y coordinates that Dagre assigned to this column
			const yCoords = ids.map((id) => g.node(id).y).sort((a, b) => a - b);

			// Sort the IDs deterministically (by created date / string ID)
			ids.sort((aId, bId) => {
				const a = proposalMap.get(aId);
				const b = proposalMap.get(bId);
				if (a?.created && b?.created) {
					const t = new Date(a.created).getTime() - new Date(b.created).getTime();
					if (t !== 0) return t;
				}
				return aId.localeCompare(bId);
			});

			// Re-assign the sorted Y coordinates back to the nodes in deterministic order
			for (let i = 0; i < ids.length; i++) {
				const ln = g.node(ids[i]);
				ln.y = yCoords[i];
			}
		}

		// 3. Apply the final coordinates to dagNodes
		for (const n of dagNodes) {
			const ln = g.node(n.id);
			if (ln) {
				n.x = ln.x;
				n.y = ln.y;
			}
		}

		// 4. Update structural edge endpoints with a smooth linear warp to prevent zigzags
		for (const e of structuralEdges) {
			const le = g.edge(e.source, e.target);
			if (le && le.points && le.points.length >= 2) {
				const srcNode = g.node(e.source);
				const tgtNode = g.node(e.target);

				const dyStart = srcNode.y - oldY.get(e.source)!;
				const dyEnd = tgtNode.y - oldY.get(e.target)!;

				const startPoint = { ...le.points[0] };
				const endPoint = { ...le.points[le.points.length - 1] };
				const totalDx = endPoint.x - startPoint.x;

				for (const pt of le.points) {
					if (Math.abs(totalDx) < 1) {
						pt.y += (dyStart + dyEnd) / 2;
					} else {
						const t = (pt.x - startPoint.x) / totalDx;
						pt.y += dyStart * (1 - t) + dyEnd * t;
					}
				}

				// 5. Re-anchor the endpoints exactly to the node perimeters
				// (Since we moved the nodes, the original bounding-box intersections are wrong)
				const pNext = le.points.length > 2 ? le.points[1] : tgtNode;
				const pPrev = le.points.length > 2 ? le.points[le.points.length - 2] : srcNode;

				const rSrc = dotMode ? 18 : srcNode.width / 2;
				const rTgt = dotMode ? 24 : tgtNode.width / 2; // +6 to prevent arrow head overlapping node

				const angleStart = Math.atan2(pNext.y - srcNode.y, pNext.x - srcNode.x);
				const angleEnd = Math.atan2(tgtNode.y - pPrev.y, tgtNode.x - pPrev.x);

				le.points[0].x = srcNode.x + Math.cos(angleStart) * rSrc;
				le.points[0].y = srcNode.y + Math.sin(angleStart) * rSrc;

				le.points[le.points.length - 1].x = tgtNode.x - Math.cos(angleEnd) * rTgt;
				le.points[le.points.length - 1].y = tgtNode.y - Math.sin(angleEnd) * rTgt;

				e.points = le.points;
			}
		}

		const lineageNodeIds = new Set<string>();
		const lineageEdgeIds = new Set<string>();
		const incomingEdgeMap = new Map<string, DagEdge[]>();
		for (const e of structuralEdges) {
			if (!incomingEdgeMap.has(e.target)) incomingEdgeMap.set(e.target, []);
			incomingEdgeMap.get(e.target)!.push(e);
		}
		const focusNodeIds = dagNodes.filter((n) => expandedNodeIds.has(n.id)).map((n) => n.id);
		if (focusNodeIds.length > 0) {
			const queue = [...focusNodeIds];
			const visited = new Set<string>(focusNodeIds);
			for (const fid of focusNodeIds) lineageNodeIds.add(fid);

			while (queue.length > 0) {
				const nodeId = queue.shift()!;
				const incoming = incomingEdgeMap.get(nodeId);
				if (!incoming) continue;
				for (const edge of incoming) {
					lineageEdgeIds.add(edge.id);
					if (!visited.has(edge.source)) {
						visited.add(edge.source);
						lineageNodeIds.add(edge.source);
						queue.push(edge.source);
					}
				}
			}
		}

		return {
			nodes: dagNodes,
			structuralEdges,
			contradictionEdges: [],
			clusters: [],
			severPoints: [],
			mergePoints: [],
			lineageNodeIds,
			lineageEdgeIds,
			fullClusterMap: new Map()
		};
	}

	let clusters: AxiomCluster[];
	const fullClusterMap = new Map<string, string>();
	const severPoints: SeverPoint[] = [];
	const mergePoints: MergePoint[] = [];

	for (const s of allProposals) {
		fullClusterMap.set(s.id, clusterMap!.get(s.id)!);
	}

	// Build active clusters from the complete fullClusterMap
	const groups = new Map<string, App.ProposalRecord[]>();
	for (const s of activeProposals) {
		const key = fullClusterMap.get(s.id);
		if (!key) continue;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key)!.push(s);
	}

	// Count total members per cluster across ALL proposals (for "N of M shown")
	const totalByStableKey = new Map<string, number>();
	for (const s of allProposals) {
		const key = fullClusterMap.get(s.id);
		if (key) {
			totalByStableKey.set(key, (totalByStableKey.get(key) ?? 0) + 1);
		}
	}

	const builtClusters: AxiomCluster[] = [];
	let idx = 0;
	for (const [stableKey, members] of groups) {
		let champion = members.find((s) => s.is_champion);
		if (!champion) {
			const hasVotes = members.some((s) => (s.subscription_count ?? 0) >= 1);
			if (hasVotes) {
				champion = [...members].sort((a, b) => {
					const diff = (b.subscription_count ?? 0) - (a.subscription_count ?? 0);
					if (diff !== 0) return diff;
					return b.created > a.created ? 1 : -1;
				})[0];
			}
		}
		const representative =
			champion || [...members].sort((a, b) => (a.created || '').localeCompare(b.created || ''))[0];

		builtClusters.push({
			id: String(idx),
			memberIds: members.map((s) => s.id),
			championId: champion?.id ?? '',
			title: representative?.title ?? 'Untitled',
			stableKey,
			color: clusterColors?.get(stableKey) || getClusterColor(idx),
			totalMemberCount: totalByStableKey.get(stableKey) ?? members.length
		});
		idx++;
	}

	clusters = builtClusters;

	// Build node-to-cluster lookup (needed for dagre compound grouping & later annotation)
	const nodeClusterMap = new Map<string, { clusterIdx: number; cluster: AxiomCluster }>();
	for (let idx = 0; idx < clusters.length; idx++) {
		const c = clusters[idx];
		for (const memberId of c.memberIds) {
			nodeClusterMap.set(memberId, { clusterIdx: idx, cluster: c });
		}
	}

	// Global inter-cluster map is perfectly accurate
	const globalClusterMap = fullClusterMap;

	// Compute global inter-cluster edges based on all proposals
	// Key is `${sourceStableKey}->${targetStableKey}` -> count
	const globalEdgeCounts = new Map<string, number>();
	for (const s of allProposals) {
		const targetKey = globalClusterMap.get(s.id);
		if (!targetKey || !s.parent_proposals) continue;
		for (const pId of s.parent_proposals) {
			const sourceKey = globalClusterMap.get(pId);
			if (sourceKey && sourceKey !== targetKey) {
				const edgeKey = `${sourceKey}->${targetKey}`;
				globalEdgeCounts.set(edgeKey, (globalEdgeCounts.get(edgeKey) || 0) + 1);
			}
		}
	}

	// ── 3. Two-phase layout: per-cluster dagre → shelf-pack clusters ──

	// Categorise nodes and edges into clusters
	const dagNodeMap = new Map<string, DagNode>();
	for (const n of dagNodes) dagNodeMap.set(n.id, n);

	// Partition edges into intra-cluster and inter-cluster
	const intraClusterEdges = new Map<string, DagEdge[]>(); // clusterId → edges
	const interClusterEdges: DagEdge[] = [];

	for (const edge of structuralEdges) {
		const srcCluster = nodeClusterMap.get(edge.source);
		const tgtCluster = nodeClusterMap.get(edge.target);

		if (srcCluster && tgtCluster && srcCluster.clusterIdx === tgtCluster.clusterIdx) {
			const cId = String(srcCluster.clusterIdx);
			if (!intraClusterEdges.has(cId)) intraClusterEdges.set(cId, []);
			intraClusterEdges.get(cId)!.push(edge);
		} else {
			interClusterEdges.push(edge);
		}
	}

	// ── 3a. Per-cluster dagre layout ──────────────────────────────────
	// Run dagre independently on each cluster subgraph with tight spacing.
	// Positions are stored relative to cluster origin (centered at 0,0).

	interface ClusterBox {
		cluster: AxiomCluster;
		clusterIdx: number;
		width: number;
		height: number;
		// Packed position (set in phase 3b)
		packedX: number;
		packedY: number;
		// Internal node relative positions (centered)
		nodePositions: Map<string, { rx: number; ry: number; w: number; h: number }>;
	}

	const isThemeTab = activeTab === 'themeDetail';
	const actualHeaderH = isThemeTab ? 0 : EXPANDED_CLUSTER_HEADER_H;
	const actualTopClearance = isThemeTab ? 0 : EXPANDED_CLUSTER_TOP_CLEARANCE;

	const INNER_NODESEP = dotMode ? 38 : 50;
	const INNER_RANKSEP = dotMode ? 55 : 70;
	const INNER_PAD = isThemeTab ? 0 : dotMode ? 20 : 30; // padding inside cluster box
	const MAX_CHILDREN_PER_COL = 4;
	const baseW = dotMode ? DOT_NODE_WIDTH : NODE_WIDTH;
	const baseH = dotMode ? DOT_NODE_HEIGHT : NODE_HEIGHT;
	const GRID_COL_GAP = baseW + 40;
	const GRID_ROW_GAP = baseH + 50;

	const clusterBoxes: ClusterBox[] = [];

	for (let idx = 0; idx < clusters.length; idx++) {
		const c = clusters[idx];
		const memberNodes = c.memberIds
			.map((id) => dagNodeMap.get(id))
			.filter((n): n is DagNode => !!n);

		if (memberNodes.length === 0) continue;

		const isCollapsed = !expandedClusters.has(c.id);

		// Single-node clusters or collapsed clusters: no dagre needed
		if (memberNodes.length === 1 || isCollapsed) {
			const n = memberNodes.find((m) => m.id === c.championId) || memberNodes[0];
			const isExpanded = expandedNodeIds.has(n.id);

			// For collapsed feed clusters, estimate width from title length
			// to match DagBoundingBox's title-based sizing.
			let w: number, h: number;
			if (isCollapsed) {
				// Card-shaped collapsed cluster: matches DagBoundingBox sizing
				w = 220;
				h = 125;
			} else {
				w = isExpanded ? EXPANDED_NODE_WIDTH : dotMode ? DOT_NODE_WIDTH : NODE_WIDTH;
				h = isExpanded ? EXPANDED_NODE_HEIGHT : dotMode ? DOT_NODE_HEIGHT : NODE_HEIGHT;
			}
			const positions = new Map<string, { rx: number; ry: number; w: number; h: number }>();
			positions.set(n.id, {
				rx: 0,
				ry: isCollapsed ? 0 : (actualHeaderH + actualTopClearance) / 2,
				w,
				h
			});

			const cw = isCollapsed ? w : Math.max(w + INNER_PAD * 2, EXPANDED_CLUSTER_MIN_WIDTH);
			const ch = isCollapsed ? h : h + INNER_PAD * 2 + actualHeaderH + actualTopClearance;

			clusterBoxes.push({
				cluster: c,
				clusterIdx: idx,
				width: cw,
				height: ch,
				packedX: 0,
				packedY: 0,
				nodePositions: positions
			});
			continue;
		}

		// Multi-node clusters: run dagre on subgraph
		const cg = new dagre.graphlib.Graph();
		cg.setGraph({
			rankdir: 'LR',
			nodesep: INNER_NODESEP,
			ranksep: INNER_RANKSEP,
			edgesep: 30,
			marginx: INNER_PAD,
			marginy: INNER_PAD
		});
		cg.setDefaultEdgeLabel(() => ({}));

		const memberIdSet = new Set(c.memberIds);
		for (const n of memberNodes) {
			const isExpanded = expandedNodeIds.has(n.id);
			cg.setNode(n.id, {
				width: isExpanded ? EXPANDED_NODE_WIDTH : dotMode ? DOT_NODE_WIDTH : NODE_WIDTH,
				height: isExpanded ? EXPANDED_NODE_HEIGHT : dotMode ? DOT_NODE_HEIGHT : NODE_HEIGHT
			});
		}

		const clusterEdges = intraClusterEdges.get(String(idx)) ?? [];
		for (const edge of clusterEdges) {
			if (cg.hasNode(edge.source) && cg.hasNode(edge.target)) {
				cg.setEdge(edge.source, edge.target, {
					weight: edge.weight,
					minlen: 1
				});
			}
		}

		dagre.layout(cg);

		// Read back positions and compute cluster bounding box
		let minX = Infinity,
			minY = Infinity,
			maxX = -Infinity,
			maxY = -Infinity;
		const rawPositions: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];

		for (const n of memberNodes) {
			const ln = cg.node(n.id);
			if (!ln) continue;
			rawPositions.push({ id: n.id, x: ln.x, y: ln.y, w: ln.width, h: ln.height });
			minX = Math.min(minX, ln.x - ln.width / 2);
			minY = Math.min(minY, ln.y - ln.height / 2);
			maxX = Math.max(maxX, ln.x + ln.width / 2);
			maxY = Math.max(maxY, ln.y + ln.height / 2);
		}

		// Convert to relative positions (centered around cluster bbox center)
		// Account for the expanded cluster header strip and top clearance spacing
		const cw = Math.max(maxX - minX + INNER_PAD * 2, EXPANDED_CLUSTER_MIN_WIDTH);
		const ch = maxY - minY + INNER_PAD * 2 + actualHeaderH + actualTopClearance;
		const centerX = (minX + maxX) / 2;
		const centerY = (minY + maxY) / 2;

		const positions = new Map<string, { rx: number; ry: number; w: number; h: number }>();
		for (const p of rawPositions) {
			// Shift children down by (header height + top clearance gap)/2 so they sit below the header
			positions.set(p.id, {
				rx: p.x - centerX,
				ry: p.y - centerY + (actualHeaderH + actualTopClearance) / 2,
				w: p.w,
				h: p.h
			});
		}

		clusterBoxes.push({
			cluster: c,
			clusterIdx: idx,
			width: cw,
			height: ch,
			packedX: 0,
			packedY: 0,
			nodePositions: positions
		});
	}

	// ── 3b. Meta-layout: dagre on cluster macro-graph ─────────────────────
	// Use dagre at the cluster-box level so connected clusters are placed
	// adjacent to each other, minimizing cross-cluster edge distance.

	const CLUSTER_GAP_X = 160; // horizontal gap between clusters
	const CLUSTER_GAP_Y = 72; // vertical gap between clusters

	// Build a lookup from clusterIdx → ClusterBox (used by later steps)
	const clusterBoxByIdx = new Map<number, ClusterBox>();
	for (const cb of clusterBoxes) {
		clusterBoxByIdx.set(cb.clusterIdx, cb);
	}

	// Build inter-cluster connectivity from structuralEdges for macro placement
	const macroEdgeCounts = new Map<string, number>(); // "srcIdx->tgtIdx" → count
	for (const edge of structuralEdges) {
		const srcInfo = nodeClusterMap.get(edge.source);
		const tgtInfo = nodeClusterMap.get(edge.target);
		if (!srcInfo || !tgtInfo) continue;
		if (srcInfo.clusterIdx === tgtInfo.clusterIdx) continue;
		// Canonical direction: parent cluster → child cluster (maintains true topological flow)
		const key = `${srcInfo.clusterIdx}->${tgtInfo.clusterIdx}`;
		macroEdgeCounts.set(key, (macroEdgeCounts.get(key) ?? 0) + 1);
	}

	// Create dagre macro graph
	const macroG = new dagre.graphlib.Graph();
	macroG.setGraph({
		rankdir: 'LR',
		nodesep: CLUSTER_GAP_Y,
		ranksep: CLUSTER_GAP_X,
		edgesep: 8,
		marginx: 0,
		marginy: 0
	});
	macroG.setDefaultEdgeLabel(() => ({}));

	// Add each cluster box as a node
	for (const cb of clusterBoxes) {
		macroG.setNode(`cb::${cb.clusterIdx}`, {
			width: cb.width,
			height: cb.height
		});
	}

	// Add inter-cluster edges (weighted by connection count)
	for (const [key, count] of macroEdgeCounts) {
		const [srcStr, tgtStr] = key.split('->');
		const srcId = `cb::${srcStr}`;
		const tgtId = `cb::${tgtStr}`;
		if (macroG.hasNode(srcId) && macroG.hasNode(tgtId)) {
			macroG.setEdge(srcId, tgtId, {
				weight: count,
				minlen: 1
			});
		}
	}

	// Run dagre layout on the macro graph
	dagre.layout(macroG);

	// Read back positions — dagre gives center positions, convert to top-left
	for (const cb of clusterBoxes) {
		const ln = macroG.node(`cb::${cb.clusterIdx}`);
		if (ln) {
			console.log(
				`[DagLayout Debug] Cluster ${cb.clusterIdx} (Collapsed: ${!expandedClusters.has(cb.cluster.id)}): y=${ln.y}, height=${cb.height}`
			);
			cb.packedX = ln.x - cb.width / 2;
			cb.packedY = ln.y - cb.height / 2;
		}
	}

	// ── 3c. Apply packed offsets → final absolute positions ──────────

	const nodeMap = new Map<string, DagNode>();

	for (const cb of clusterBoxes) {
		// Cluster center in packed coordinates
		const cx = cb.packedX + cb.width / 2;
		const cy = cb.packedY + cb.height / 2;

		for (const [nodeId, pos] of cb.nodePositions) {
			const node = dagNodeMap.get(nodeId);
			if (!node) continue;
			node.x = cx + pos.rx;
			node.y = cy + pos.ry;
			node.width = pos.w;
			node.height = pos.h;
			nodeMap.set(nodeId, node);
		}
	}

	// Also register any dagNodes that weren't in any cluster (shouldn't happen, but safety)
	for (const node of dagNodes) {
		if (!nodeMap.has(node.id)) {
			nodeMap.set(node.id, node);
		}
	}

	// ── 6. Build group nodes + child nodes ─────────────────────────────
	//
	// Every cluster is represented by a group node (type: clusterGroup).
	//   Collapsed: the group node IS the visible card; no children emitted.
	//   Expanded:  the group node is a transparent container; member proposal
	//              nodes are emitted as children with parentId set.
	//
	// x/y on every DagNode remains the absolute graph-space center.
	// DagMap will convert children to relative positions when building the
	// SvelteFlow nodes array.

	const visibleNodes: DagNode[] = [];

	// Map: memberId → group node ID for collapsed clusters (used in edge remapping)
	const collapsedGroupMap = new Map<string, string>();

	const COLLAPSED_BOX_W = 220;
	const COLLAPSED_BOX_H = 125;

	for (let cidx = 0; cidx < clusters.length; cidx++) {
		const c = clusters[cidx];
		const cb = clusterBoxByIdx.get(cidx);
		if (!cb) continue;

		const isCollapsed = !expandedClusters.has(String(cidx));
		const groupId = `cluster-group::${cidx}`;

		if (isCollapsed) {
			// ── Collapsed: single group node (the card) ──
			let champNode = nodeMap.get(c.championId);
			if (!champNode) {
				champNode = nodeMap.get(c.stableKey);
			}
			if (!champNode && c.memberIds.length > 0) {
				champNode = nodeMap.get(c.memberIds[0]);
			}
			if (!champNode) continue;

			for (const memberId of c.memberIds) {
				collapsedGroupMap.set(memberId, groupId);
			}

			visibleNodes.push({
				id: groupId,
				x: champNode.x,
				y: champNode.y,
				width: COLLAPSED_BOX_W,
				height: COLLAPSED_BOX_H,
				proposal: champNode.proposal,
				kind: champNode.kind,
				inArena: false,
				isChampion: false,
				userVote: userVotes[champNode.proposal.id] ?? 0,
				isCompound: true, // collapsed card UI
				clusterMemberCount: c.memberIds.length,
				clusterTotalMemberCount: c.totalMemberCount ?? c.memberIds.length,
				clusterTitle: c.title,
				clusterIndex: cidx,
				isGroupNode: true
			});
		} else {
			// ── Expanded: transparent group node + child proposal nodes ──
			const gx = cb.packedX;
			const gy = cb.packedY;
			const gw = cb.width;
			const gh = cb.height;

			// Group node — parent must be emitted BEFORE its children
			visibleNodes.push({
				id: groupId,
				x: gx + gw / 2, // absolute center
				y: gy + gh / 2,
				width: gw,
				height: gh,
				proposal: {} as any,
				kind: 'root',
				inArena: false,
				isChampion: false,
				userVote: 0,
				isCompound: false, // expanded box UI
				clusterMemberCount: c.memberIds.length,
				clusterTotalMemberCount: c.totalMemberCount ?? c.memberIds.length,
				clusterTitle: c.title,
				clusterIndex: cidx,
				isGroupNode: true
			});

			// Child proposal nodes (absolute positions; DagMap converts to relative)
			for (const memberId of c.memberIds) {
				const n = nodeMap.get(memberId);
				if (!n) continue;
				visibleNodes.push({ ...n, parentId: groupId });
			}
		}
	}

	// ── 7. Build final edge sets ────────────────────────────────────────
	//
	// Rule:
	//   • Inter-cluster edges are ALWAYS aggregated into a single thick
	//     cluster-bridge line between the two group nodes, UNLESS a specific
	//     proposal card is individually expanded (expandedNodeIds).
	//   • Only an individually expanded proposal card generates its own direct
	//     edge to the other cluster's group node (or the other card if both
	//     are individually expanded).
	//   • Opening a cluster container alone (expandedClusters) does NOT cause
	//     individual inter-cluster edges — the stub arrows on each proposal
	//     node indicate the cross-cluster parentage instead.
	//
	// This means:
	//   card expanded → direct edge from/to that card & other cluster group node
	//   otherwise     → one thick cluster-bridge between group nodes

	const finalStructuralEdges: DagEdge[] = [];

	// Helper: is a given clusterIdx currently showing its children?
	function clusterIsExpanded(idx: number): boolean {
		return expandedClusters.has(String(idx));
	}

	// Aggregate bucket: inter-cluster edges that are not individually surfaced
	// are bucketed by (canonical groupNode → canonical groupNode).
	const aggBucket = new Map<string, { source: string; target: string; count: number }>();

	for (const edge of structuralEdges) {
		const srcInfo = nodeClusterMap.get(edge.source);
		const tgtInfo = nodeClusterMap.get(edge.target);
		if (!srcInfo || !tgtInfo) continue;

		const srcExp = clusterIsExpanded(srcInfo.clusterIdx);
		const tgtExp = clusterIsExpanded(tgtInfo.clusterIdx);

		// ── Intra-cluster ──────────────────────────────────────────────────
		if (srcInfo.clusterIdx === tgtInfo.clusterIdx) {
			if (srcExp) {
				finalStructuralEdges.push({ ...edge, mergeCount: 1, isClusterEdge: false });
			}
			continue;
		}

		// ── Inter-cluster: only show individual edges when the specific card is expanded ──
		// Cluster being open (expandedClusters) is NOT enough — the stub arrows
		// on each node already indicate the cross-cluster relationship.
		const srcCardExpanded = expandedNodeIds.has(edge.source);
		const tgtCardExpanded = expandedNodeIds.has(edge.target);

		if (srcCardExpanded || tgtCardExpanded) {
			const finalSource = srcCardExpanded ? edge.source : `cluster-group::${srcInfo.clusterIdx}`;
			const finalTarget = tgtCardExpanded ? edge.target : `cluster-group::${tgtInfo.clusterIdx}`;

			if (finalSource !== finalTarget) {
				finalStructuralEdges.push({
					...edge,
					source: finalSource,
					target: finalTarget,
					mergeCount: 1,
					isClusterEdge: false
				});
				continue;
			}
		}

		// ── Inter-cluster: always aggregate at cluster-box level ──────
		// Even when both clusters are expanded, cross-cluster edges are shown
		// as a single thick line between the bounding boxes — not N individual
		// proposal-to-proposal lines that overwhelm the graph.
		const remappedSrc = `cluster-group::${srcInfo.clusterIdx}`;
		const remappedTgt = `cluster-group::${tgtInfo.clusterIdx}`;

		if (remappedSrc === remappedTgt) continue;

		// Normalize direction using dagre-assigned X position so that
		// left→right edges are canonical. Ties broken by cluster index.
		const srcX = clusterBoxByIdx.get(srcInfo.clusterIdx)?.packedX ?? srcInfo.clusterIdx;
		const tgtX = clusterBoxByIdx.get(tgtInfo.clusterIdx)?.packedX ?? tgtInfo.clusterIdx;
		const canonSrc =
			srcX < tgtX || (srcX === tgtX && srcInfo.clusterIdx <= tgtInfo.clusterIdx)
				? remappedSrc
				: remappedTgt;
		const canonTgt = canonSrc === remappedSrc ? remappedTgt : remappedSrc;

		const aggKey = `${canonSrc}->${canonTgt}`;
		const existing = aggBucket.get(aggKey);
		if (existing) {
			existing.count++;
		} else {
			aggBucket.set(aggKey, { source: canonSrc, target: canonTgt, count: 1 });
		}
	}

	// Emit one bounding-box edge per (canonical-src, canonical-tgt) pair
	for (const [aggKey, agg] of aggBucket) {
		// Derive cluster color from whichever endpoint is a group node
		let bridgeColor: string | undefined;
		const srcGroupIdx = agg.source.startsWith('cluster-group::')
			? Number(agg.source.replace('cluster-group::', ''))
			: undefined;
		const tgtGroupIdx = agg.target.startsWith('cluster-group::')
			? Number(agg.target.replace('cluster-group::', ''))
			: undefined;
		const bridgeClusterIdx = tgtGroupIdx ?? srcGroupIdx;
		if (bridgeClusterIdx !== undefined && clusters[bridgeClusterIdx]) {
			bridgeColor = clusters[bridgeClusterIdx].color ?? '#a9a9a9';
		}

		finalStructuralEdges.push({
			id: `cluster_agg::${aggKey}`,
			source: agg.source,
			target: agg.target,
			type: 'structural',
			label: '',
			weight: SYNTHESIS_EDGE_WEIGHT,
			mergeCount: agg.count,
			isClusterEdge: true,
			clusterColor: bridgeColor
		});
	}

	// (Merge-dot injection removed — combination edges converge directly at the target node.
	//  The combination reason is shown as a badge on the synthesis node itself.)

	// Build the final list of all structural edges (no merge-dot patching needed)
	const allFinalEdges = finalStructuralEdges;

	// Question node removed — description shown in Question tab

	// ── 9. Compute lineage paths ──────────────────────────────────────
	const lineageNodeIds = new Set<string>();
	const lineageEdgeIds = new Set<string>();

	// Build an adjacency map: target → edges (for upward traversal)
	const incomingEdgeMap = new Map<string, DagEdge[]>();
	for (const e of allFinalEdges) {
		if (!incomingEdgeMap.has(e.target)) incomingEdgeMap.set(e.target, []);
		incomingEdgeMap.get(e.target)!.push(e);
	}

	// Determine focus nodes for lineage traversal
	const focusNodeIds: string[] = [];
	if (activeTab === 'proposal' || activeTab === 'compare') {
		for (const n of visibleNodes) {
			if (n.isGroupNode) continue;
			// Check if this node is one of the explicitly focused/compared nodes
			// The caller passes the focused IDs through expandedNodeIds or as part of
			// the active proposals. We identify them by checking the expandedNodeIds set.
			if (expandedNodeIds.has(n.id)) {
				focusNodeIds.push(n.id);
			}
		}
	}

	if (focusNodeIds.length > 0) {
		// BFS upward from each focus node, collecting all edges and nodes in the path
		const queue = [...focusNodeIds];
		const visited = new Set<string>(focusNodeIds);
		for (const fid of focusNodeIds) lineageNodeIds.add(fid);

		while (queue.length > 0) {
			const nodeId = queue.shift()!;
			const incoming = incomingEdgeMap.get(nodeId);
			if (!incoming) continue;
			for (const edge of incoming) {
				lineageEdgeIds.add(edge.id);
				if (!visited.has(edge.source)) {
					visited.add(edge.source);
					lineageNodeIds.add(edge.source);
					queue.push(edge.source);
				}
			}
		}
	}

	return {
		nodes: visibleNodes,
		structuralEdges: allFinalEdges,
		contradictionEdges: [],
		clusters,
		severPoints,
		mergePoints,
		lineageNodeIds,
		lineageEdgeIds,
		fullClusterMap
	};
}
