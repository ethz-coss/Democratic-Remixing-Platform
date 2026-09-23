// @ts-nocheck
// src/hooks/services/ballot-engine.ts
//
// Determines the final ballot (Focus ideas) based on the Even Distribution algorithm.
// Takes up to 7 champions, sorted by the 3-tier tie-breaking chain, excluding
// any champion whose labels overlap with an idea already on the ballot.
//
// Invariant: primary_label is always a member of the labels array.
// Label exclusion uses the full labels array, which inherently covers primary_label.
//
// Tie-breaking chain:
//   1. Highest subscription_count
//   2. Highest label_support_score (total engagement across all topics)
//   3. Oldest created date (deterministic fallback)

export interface BallotConfig {
	maxSlots?: number;
	minSubscribers?: number;
	exclusivityMode?: 'full' | 'primary_only' | 'none';
}

export function selectBallot(champions: any[], maxSlots: number = 7, config?: BallotConfig): any[] {
	const minSubs = config?.minSubscribers ?? 2;
	const maxB = config?.maxSlots ?? maxSlots;
	const exclusivity = config?.exclusivityMode ?? 'full';

	// Filter for eligibility
	var eligible = champions.filter(function(c) {
		return Number(c.subscription_count || 0) >= minSubs;
	});

	// Sort by the 3-tier tie-breaking chain
	var sorted = eligible.sort(function(a, b) {
		var scoreA = Number(a.subscription_count || 0);
		var scoreB = Number(b.subscription_count || 0);
		if (scoreB !== scoreA) {
			return scoreB - scoreA;
		}
		// Tie-breaker 1: higher label_support_score wins
		var labelScoreA = Number(a.label_support_score || 0);
		var labelScoreB = Number(b.label_support_score || 0);
		if (labelScoreB !== labelScoreA) {
			return labelScoreB - labelScoreA;
		}
		// Tie-breaker 2 (fallback): oldest created wins
		var dateA = new Date(a.created).getTime();
		var dateB = new Date(b.created).getTime();
		return dateA - dateB;
	});

	var ballot: any[] = [];
	var seenLabels: { [id: string]: boolean } = {};

	for (var i = 0; i < sorted.length; i++) {
		if (ballot.length >= maxB) break;
		
		var c = sorted[i];
		var hasOverlap = false;
		
		if (exclusivity === 'full') {
			var cLabels = c.labels || [];
			for (var j = 0; j < cLabels.length; j++) {
				if (seenLabels[cLabels[j]]) {
					hasOverlap = true;
					break;
				}
			}
		} else if (exclusivity === 'primary_only') {
			var primary = c.primary_label;
			if (primary && seenLabels[primary]) {
				hasOverlap = true;
			}
		} else if (exclusivity === 'none') {
			hasOverlap = false;
		}

		if (!hasOverlap) {
			ballot.push(c);
			// Mark labels as seen
			if (exclusivity === 'full') {
				var cLabels = c.labels || [];
				for (var j = 0; j < cLabels.length; j++) {
					seenLabels[cLabels[j]] = true;
				}
			} else if (exclusivity === 'primary_only') {
				var primary = c.primary_label;
				if (primary) {
					seenLabels[primary] = true;
				}
			}
		}
	}

	return ballot;
}
