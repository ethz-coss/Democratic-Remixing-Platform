/**
 * Pure filter / sort / group utilities for the DiscoveryFeed.
 * These functions are side-effect free and fully testable.
 *
 * Fuzzy search is powered by Fuse.js: https://www.fusejs.io/
 * It handles typos and partial matches (threshold 0.35 = quite lenient).
 */

import Fuse from 'fuse.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SortMode =
	| 'Trending'
	| 'Newest'
	| 'Alphabetical'
	| 'TopSupport'
	| 'NeedsAttention'
	| 'PersonalFocus'
	| 'RecentlyVisited';

export interface PersonalFocusWeights {
	explorationBoostWeight?: number;
	unseenMultiplier?: number;
	subscribedPenalty?: number;
	diversityWeight?: number;
	bridgingWeight?: number;
	affinityWeight?: number;
	timeDecayWeight?: number;
	smoothingPseudocount?: number;
}

export interface FilterOptions {
	onlySupported: boolean;
	onlyAuthored: boolean;
	onlyInFocus: boolean;
	onlyChampions: boolean;
	onlyCombinations: boolean;
	onlyImprovements: boolean;
	onlyUnseen: boolean;
	onlyHidden: boolean;
	userVotes: Record<string, number>;
	userId: string | null | undefined;
	championIds: Set<string>;
	searchQuery: string;
	seenProposalIds?: Set<string>;
	labelAffinities?: Map<string, number>;
	userHiddenProposalIds?: Set<string>;
	hideSubscribed?: boolean;
	onlyComparePool?: boolean;
	comparePoolIds?: Set<string>;
	selectedLabelId?: string | null;
	personalFocusWeights?: PersonalFocusWeights;
}

export interface LabelGroup {
	labelId: string;
	commonTitle: string;
	labelColor: string;
	proposals: App.ProposalRecord[];
	maxSubscription: number;
	maxTime: number;
	maxTrending: number;
	championScore: number;
}

// ─── Internal Fuse.js instance cache ────────────────────────────────────────
// We rebuild the index only when the proposals array reference changes.
let lastProposals: App.ProposalRecord[] | null = null;
let fuseInstance: Fuse<App.ProposalRecord> | null = null;

function getFuseInstance(proposals: App.ProposalRecord[]): Fuse<App.ProposalRecord> {
	if (proposals !== lastProposals) {
		lastProposals = proposals;
		fuseInstance = new Fuse(proposals, {
			// Fields to search (title weighted more than content)
			keys: [
				{ name: 'title', weight: 2 },
				{ name: 'content', weight: 1 }
			],
			// 0 = exact, 1 = match anything.  0.35 allows small typos / partial matches
			threshold: 0.35,
			// Return the full item (not just metadata)
			includeScore: false,
			// Minimum number of characters that must match
			minMatchCharLength: 2,
			// Allow searching within longer strings (full content)
			ignoreLocation: true
		});
	}
	return fuseInstance!;
}

// ─── Scoring helpers ─────────────────────────────────────────────────────────

export function getTrendingScore(p: App.ProposalRecord): number {
	const hours = (Date.now() - new Date(p.created).getTime()) / 3_600_000;
	return (p.subscription_count ?? 0) / Math.max(0, hours + 2);
}

/**
 * "Needs Attention" score: old proposals with few views surface first.
 * Enhanced to use unique_viewer_count to properly distinguish unseen vs ignored.
 */
export function getNeedsAttentionScore(p: App.ProposalRecord): number {
	const hours = (Date.now() - new Date(p.created).getTime()) / 3_600_000;
	const viewerCount = (p as any).unique_viewer_count ?? 0;
	const conversionRate = viewerCount > 0 ? (p.subscription_count ?? 0) / viewerCount : 0;
	// High hours + low views = needs eyeballs (boost)
	// High hours + high views + low support = deliberate pass (reduce)
	const viewPenalty = viewerCount > 3 ? (1 - conversionRate) * 0.5 : 1;
	return (hours / Math.max(1, p.subscription_count ?? 0)) * viewPenalty;
}

/**
 * "Personal Focus" score: personalized relevance using view history, label affinity, and votes.
 */
export function getPersonalizedScore(
	p: App.ProposalRecord,
	isSeen: boolean,
	userVote: number,
	labelAffinities?: Map<string, number>,
	getLabelAvgViews?: (labelId: string) => number,
	pfWeights?: PersonalFocusWeights
): number {
	const views = (p as any).unique_viewer_count ?? 0;
	const subs = p.subscription_count ?? 0;
	const hoursAge = (Date.now() - new Date(p.created).getTime()) / 3_600_000;

	const EXPLORATION_WEIGHT = pfWeights?.explorationBoostWeight ?? 1.0;
	const UNSEEN_MULTIPLIER = pfWeights?.unseenMultiplier ?? 2.0;
	const SUBSCRIBED_PENALTY = pfWeights?.subscribedPenalty ?? 0.1;
	const DIVERSITY_WEIGHT = pfWeights?.diversityWeight ?? 2.0;
	const BRIDGING_WEIGHT = pfWeights?.bridgingWeight ?? 1.5;
	const AFFINITY_WEIGHT = pfWeights?.affinityWeight ?? 1.0;
	const TIME_DECAY_WEIGHT = pfWeights?.timeDecayWeight ?? 1.0;
	const SMOOTHING = pfWeights?.smoothingPseudocount ?? 1.0;

	// 1. Smoothed conversion rate (pseudocount controls regularization strength)
	const smoothedConversion = (subs + SMOOTHING) / (views + 5 * SMOOTHING);

	// 2. Exploration boost (items with few views get bumped to be judged)
	const explorationBoost = EXPLORATION_WEIGHT * (1 / Math.sqrt(views + 1));

	// Base score combining quality and exploration need
	let score = smoothedConversion + explorationBoost;

	// 3. Label Affinity (Exploitation)
	let personalAffinity = 1.0;
	const labels = p.labels || [];
	if (labels.length > 0 && labelAffinities) {
		let maxAffinity = 0;
		for (const l of labels) {
			const interactions = labelAffinities.get(l) ?? 0;
			if (interactions > maxAffinity) maxAffinity = interactions;
		}
		// Logarithmic scaling for affinity
		personalAffinity = 1 + AFFINITY_WEIGHT * Math.log(maxAffinity + 1);
	} else {
		// Slight bump for unlabeled to encourage categorization
		personalAffinity = 1.0 + (0.2 * AFFINITY_WEIGHT);
	}
	score *= personalAffinity;

	// 4. Diversity Routing Boost (Targeted Exploration)
	const diversityBoost =
		1 + DIVERSITY_WEIGHT * (1 / Math.sqrt(views + 1)) * (1 / Math.max(1, personalAffinity));
	score *= diversityBoost;

	// 5. Bridging Consensus Boost (Exploitation/Virality)
	const bridgingBoost = 1 + BRIDGING_WEIGHT * smoothedConversion * Math.log10(views + 2);
	score *= bridgingBoost;

	// 6. Unseen Multiplier (encourage looking at new things)
	if (!isSeen) score *= UNSEEN_MULTIPLIER;

	// 7. Subscribed Penalty (we want them to find *new* things to subscribe to)
	if (userVote > 0) score *= SUBSCRIBED_PENALTY;

	// 8. Time decay (keeps the feed fresh; weight controls decay steepness)
	const timeDecay = 1 / Math.max(1, Math.pow(Math.log10(hoursAge + 10), TIME_DECAY_WEIGHT));
	score *= timeDecay;

	return score;
}

// ─── Filter ──────────────────────────────────────────────────────────────────

/**
 * Applies all active filter chips and fuzzy search to a flat list of proposals.
 *
 * @param proposals - Full list (pre-filtered for non-terminal, etc. by caller)
 * @param temporarilyInjected - IDs that bypass all filters (parent injection)
 * @param opts - Active filter state
 */
export function filterProposals(
	proposals: App.ProposalRecord[],
	temporarilyInjected: Set<string>,
	opts: FilterOptions
): App.ProposalRecord[] {
	const { searchQuery } = opts;

	// ── Step 1: apply fuzzy search to the full list first ─────────────
	let searchFiltered: App.ProposalRecord[];
	if (searchQuery.trim().length >= 2) {
		const fuse = getFuseInstance(proposals);
		const results = fuse.search(searchQuery.trim());
		const matchIds = new Set(results.map((r) => r.item.id));
		searchFiltered = proposals.filter((p) => temporarilyInjected.has(p.id) || matchIds.has(p.id));
	} else {
		searchFiltered = proposals;
	}

	// ── Step 2: apply chip filters ────────────────────────────────────
	return searchFiltered.filter((p) => {
		if (temporarilyInjected.has(p.id)) return true;
		if (p.state === 'FinalWinner') return false;
		const isHidden = opts.userHiddenProposalIds && opts.userHiddenProposalIds.has(p.id);

		if (opts.onlyHidden) {
			if (!isHidden) return false;
		} else {
			if (isHidden) return false;
		}
		if (opts.hideSubscribed && (opts.userVotes[p.id] ?? 0) > 0) return false;
		if (opts.onlySupported && (opts.userVotes[p.id] ?? 0) <= 0) return false;
		if (opts.onlyAuthored && opts.userId && p.author !== opts.userId) return false;
		if (opts.onlyInFocus && !p.in_focus) return false;
		if (opts.onlyChampions && !opts.championIds.has(p.id)) return false;
		const parentCount = p.parent_proposals?.length ?? 0;
		if (opts.onlyCombinations && parentCount < 2) return false;
		if (opts.onlyImprovements && parentCount !== 1) return false;
		if (opts.onlyUnseen && opts.seenProposalIds && opts.seenProposalIds.has(p.id)) return false;

		if (opts.selectedLabelId) {
			const hasLabel =
				p.primary_label === opts.selectedLabelId || (p.labels || []).includes(opts.selectedLabelId);
			if (!hasLabel) return false;
		}

		return true;
	});
}

// ─── Sort ────────────────────────────────────────────────────────────────────

/**
 * Sorts a proposals array in-place by the given mode.
 * Returns the same array reference (sorted) for easy chaining.
 */
export function sortProposals(
	proposals: App.ProposalRecord[],
	mode: SortMode,
	opts?: FilterOptions,
	direction: 'asc' | 'desc' = 'desc'
): App.ProposalRecord[] {
	const sorted = (() => {
		switch (mode) {
			case 'Newest':
				return proposals.sort(
					(a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()
				);
			case 'TopSupport':
				return proposals.sort((a, b) => (b.subscription_count ?? 0) - (a.subscription_count ?? 0));
			case 'Alphabetical':
				return proposals.sort((a, b) => a.title.localeCompare(b.title));
			case 'NeedsAttention':
				return proposals.sort((a, b) => getNeedsAttentionScore(b) - getNeedsAttentionScore(a));
			case 'PersonalFocus': {
				if (!opts) return proposals.sort((a, b) => getTrendingScore(b) - getTrendingScore(a));

				// Compute label average views
				const labelViews = new Map<string, { sum: number; count: number }>();
				for (const p of proposals) {
					const views = (p as any).unique_viewer_count ?? 0;
					for (const l of p.labels || []) {
						const current = labelViews.get(l) || { sum: 0, count: 0 };
						current.sum += views;
						current.count += 1;
						labelViews.set(l, current);
					}
				}
				const getLabelAvgViews = (labelId: string) => {
					const stat = labelViews.get(labelId);
					return stat && stat.count > 0 ? stat.sum / stat.count : 0;
				};

				return proposals.sort((a, b) => {
					const aSeen = opts.seenProposalIds?.has(a.id) ?? false;
					const bSeen = opts.seenProposalIds?.has(b.id) ?? false;
					const aVote = opts.userVotes[a.id] ?? 0;
					const bVote = opts.userVotes[b.id] ?? 0;
					const aScore = getPersonalizedScore(
						a,
						aSeen,
						aVote,
						opts.labelAffinities,
						getLabelAvgViews,
						opts.personalFocusWeights
					);
					const bScore = getPersonalizedScore(
						b,
						bSeen,
						bVote,
						opts.labelAffinities,
						getLabelAvgViews,
						opts.personalFocusWeights
					);
					return bScore - aScore;
				});
			}
			case 'RecentlyVisited': {
				if (!opts || !opts.seenProposalIds) return proposals;
				// Create a map to O(1) lookup index
				const orderMap = new Map<string, number>();
				let idx = 0;
				for (const id of opts.seenProposalIds) {
					orderMap.set(id, idx++);
				}
				return proposals.sort((a, b) => {
					// Default to infinity so unseen items go to the bottom
					const aIdx = orderMap.get(a.id) ?? Infinity;
					const bIdx = orderMap.get(b.id) ?? Infinity;
					return aIdx - bIdx;
				});
			}
			case 'Trending':
			default:
				return proposals.sort((a, b) => getTrendingScore(b) - getTrendingScore(a));
		}
	})();

	if (direction === 'asc') {
		sorted.reverse();
	}

	return sorted;
}

// ─── Label grouping ────────────────────────────────────────────────────────

/**
 * Groups an already-filtered-and-sorted proposals array by primary label.
 * Label groups are sorted descending by their champion's absolute score.
 */
export function groupProposalsByLabel(
	proposals: App.ProposalRecord[],
	labels: App.LabelRecord[],
	sortMode: SortMode,
	opts?: FilterOptions
): LabelGroup[] {
	const groupsMap = new Map<string, App.ProposalRecord[]>();
	const labelMap = new Map<string, App.LabelRecord>(labels.map((l) => [l.id, l]));

	for (const p of proposals) {
		const key = p.primary_label || '__none__';
		if (!groupsMap.has(key)) groupsMap.set(key, []);
		groupsMap.get(key)!.push(p);
	}

	const groups: LabelGroup[] = Array.from(groupsMap.entries()).map(([key, sols]) => {
		// Sort proposals within each label group
		const sortedSols = sortProposals([...sols], sortMode, opts);
		const maxSubscription = Math.max(...sols.map((s) => s.subscription_count ?? 0), 0);
		const maxTime = Math.max(...sols.map((s) => new Date(s.created).getTime()), 0);
		const maxTrending = Math.max(...sols.map((s) => getTrendingScore(s)), 0);

		let groupScore = 0;
		if (sortMode === 'PersonalFocus' && opts) {
			// Compute label average views for this group (could be optimized, but good enough for now)
			const labelViews = new Map<string, { sum: number; count: number }>();
			for (const p of proposals) {
				const views = (p as any).unique_viewer_count ?? 0;
				for (const l of p.labels || []) {
					const current = labelViews.get(l) || { sum: 0, count: 0 };
					current.sum += views;
					current.count += 1;
					labelViews.set(l, current);
				}
			}
			const getLabelAvgViews = (labelId: string) => {
				const stat = labelViews.get(labelId);
				return stat && stat.count > 0 ? stat.sum / stat.count : 0;
			};

			groupScore = Math.max(
				...sols.map((s) => {
					const isSeen = opts.seenProposalIds?.has(s.id) ?? false;
					const userVote = opts.userVotes[s.id] ?? 0;
					return getPersonalizedScore(s, isSeen, userVote, opts.labelAffinities, getLabelAvgViews, opts.personalFocusWeights);
				})
			);
		} else {
			// group score is simply the max subscription
			groupScore = Math.max(...sols.map((s) => s.subscription_count ?? 0));
		}

		const label = labelMap.get(key);
		return {
			labelId: key,
			commonTitle: label?.short_name ?? 'Unlabeled',
			labelColor: label?.color ?? '#aaa',
			proposals: sortedSols,
			maxSubscription,
			maxTime,
			maxTrending,
			championScore: groupScore
		};
	});

	// Groups always ordered descending by their max score
	groups.sort((a, b) => b.championScore - a.championScore);
	return groups;
}

// ─── Fuzzy match set (for the DAG map to dim nodes) ─────────────────────────

/**
 * Returns a Set of proposal IDs that match the current fuzzy search query.
 * If query is empty / too short, returns null (means "show all").
 */
export function getFuzzyMatchIds(
	proposals: App.ProposalRecord[],
	searchQuery: string
): Set<string> | null {
	if (searchQuery.trim().length < 2) return null;
	const fuse = getFuseInstance(proposals);
	const results = fuse.search(searchQuery.trim());
	return new Set(results.map((r) => r.item.id));
}
