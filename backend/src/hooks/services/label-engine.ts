// @ts-nocheck
// src/hooks/services/label-engine.ts
//
// Identifies the Champion proposal for each label.
//
// The Champion is the proposal with the highest subscription_count.
// Tie-breaking chain:
//   1. Highest subscription_count
//   2. Highest label_support_score (total engagement across all topics)
//   3. Oldest created date (deterministic fallback)

export function identifyChampions(proposals: any[]): { [labelId: string]: any } {
	var championsByLabel: { [labelId: string]: any } = {};

	for (var i = 0; i < proposals.length; i++) {
		var sol = proposals[i];
		var labelId = sol.primary_label;
		if (!labelId) continue; // Skip proposals without a primary label

		var currentChamp = championsByLabel[labelId];
		var score = Number(sol.subscription_count || 0);

		if (!currentChamp) {
			championsByLabel[labelId] = sol;
		} else {
			var champScore = Number(currentChamp.subscription_count || 0);
			if (score > champScore) {
				championsByLabel[labelId] = sol;
			} else if (score === champScore) {
				// Tie-breaker 1: higher label_support_score wins
				var solLabelScore = Number(sol.label_support_score || 0);
				var champLabelScore = Number(currentChamp.label_support_score || 0);
				if (solLabelScore > champLabelScore) {
					championsByLabel[labelId] = sol;
				} else if (solLabelScore === champLabelScore) {
					// Tie-breaker 2 (fallback): oldest created date wins
					var solDate = new Date(sol.created).getTime();
					var champDate = new Date(currentChamp.created).getTime();
					if (solDate < champDate) {
						championsByLabel[labelId] = sol;
					}
				}
			}
		}
	}

	return championsByLabel;
}
