// @ts-nocheck
// src/hooks/services/score-recalc-engine.ts
//
// Orchestrates Label Champion & Ballot selection on every vote change.
//
// Pipeline:
//   1. Score Proposals (subscription_count = current_score)
//   2. Compute label_support_score for tie-breaking
//   3. Identify Label Champions
//   4. Determine Ballot (top 7 champions, label-exclusive)
//   5. Persist all changes (state transitions)

export function recalcForQuestion(questionId: string) {
	if (!questionId) return;

	var labelEngine = require($filepath.join(__hooks, 'services', 'label-engine.js'));
	var ballotEngine = require($filepath.join(__hooks, 'services', 'ballot-engine.js'));
	var helpers = require($filepath.join(__hooks, 'utils', 'helpers.js'));

	try {
		// ── Step 1: Score Proposals ────────────────────────────────────────
		var rawVotes = arrayOf(new DynamicModel({
			user: "",
			proposal: "",
			vote: 0
		}));
		$app.db().newQuery("SELECT user, proposal, vote FROM proposal_votes WHERE question = {:pid}")
			.bind({ pid: questionId })
			.all(rawVotes);

		var supportBySol: { [id: string]: number } = {};

		rawVotes.forEach(function(v) {
			var propId = helpers.extractId(v.get ? v.get('proposal') : v.proposal);
			var vote = Number((v.get ? v.get('vote') : v.vote) || 0);
			if (propId && vote > 0) {
				supportBySol[propId] = (supportBySol[propId] || 0) + 1;
			}
		});

		var rawProposals = arrayOf(new DynamicModel({
			id: "",
			subscription_count: 0,
			primary_label: "",
			labels: "",
			created: "",
			state: "",
			in_focus: false,
			is_champion: false
		}));
		$app.db().newQuery("SELECT id, subscription_count, primary_label, labels, created, state, in_focus, is_champion FROM proposals WHERE question = {:pid}")
			.bind({ pid: questionId })
			.all(rawProposals);

		var proposalsData: any[] = [];

		rawProposals.forEach(function(sol) {
			var solId = sol.id;
			var newSupport = Number(supportBySol[solId] || 0);
			var currentSupport = Number(sol.subscription_count || 0);

			if (newSupport !== currentSupport) {
				try {
					$app.db().newQuery("UPDATE proposals SET subscription_count = {:s} WHERE id = {:id}")
						.bind({ s: newSupport, id: solId })
						.execute();
				} catch(err) { console.log('[score-recalc] Error saving counts for sol ' + solId + ': ' + err); }
			}

			proposalsData.push({
				id: solId,
				subscription_count: newSupport,
				primary_label: helpers.extractId(sol.primary_label),
				labels: helpers.parseJsonArray(sol.labels),
				created: String(sol.created || ''),
				state: String(sol.state || ''),
				in_focus: !!sol.in_focus,
				is_champion: !!sol.is_champion
			});
		});

		// ── Step 2: Compute label_support_score for tie-breaking ──────────
		// For each label, sum the subscription_count of all proposals tagged with it.
		var supportByLabel: { [labelId: string]: number } = {};
		proposalsData.forEach(function(sol) {
			(sol.labels || []).forEach(function(labelId: string) {
				supportByLabel[labelId] = (supportByLabel[labelId] || 0) + sol.subscription_count;
			});
		});

		// For each proposal, label_support_score = sum of supportByLabel for all its labels.
		// This captures "how popular are the topics this idea addresses?"
		proposalsData.forEach(function(sol) {
			var score = 0;
			(sol.labels || []).forEach(function(labelId: string) {
				score += (supportByLabel[labelId] || 0);
			});
			sol.label_support_score = score;
		});

		// ── Step 3: Identify Label Champions ───────────────────────────────
		var championsByLabel = labelEngine.identifyChampions(proposalsData);
		var champions = Object.values(championsByLabel);
		var champIds: { [id: string]: boolean } = {};
		champions.forEach(function(p: any) { champIds[p.id] = true; });

		// ── Step 4: Determine Ballot ───────────────────────────────────────
		var rawQuestions = arrayOf(new DynamicModel({
			algorithm_config: ""
		}));
		$app.db().newQuery("SELECT algorithm_config FROM questions WHERE id = {:pid}")
			.bind({ pid: questionId })
			.all(rawQuestions);
		
		var ballotConfig = undefined;
		if (rawQuestions.length > 0) {
			var configRaw = rawQuestions[0].algorithm_config;
			try {
				var parsed = typeof configRaw === 'string' && configRaw ? JSON.parse(configRaw) : (configRaw || {});
				if (parsed && parsed.ballot) {
					ballotConfig = parsed.ballot;
				}
			} catch(e) { console.log('[score-recalc] failed to parse algorithm_config: ' + e); }
		}

		var focusProposals = ballotEngine.selectBallot(champions, 7, ballotConfig);
		var focusIds: { [id: string]: boolean } = {};
		focusProposals.forEach(function(p: any) { focusIds[p.id] = true; });

		// ── Step 5: Persist State Changes ──────────────────────────────────
		proposalsData.forEach(function(sol) {
			var shouldBeFocus = !!focusIds[sol.id];
			var shouldBeChampion = !!champIds[sol.id];

			var isFocus = sol.in_focus;
			var isChampion = sol.is_champion;

			if (shouldBeFocus !== isFocus || shouldBeChampion !== isChampion) {
				try {
					$app.db().newQuery("UPDATE proposals SET in_focus = {:inFocus}, is_champion = {:isChampion} WHERE id = {:id}")
						.bind({ inFocus: shouldBeFocus, isChampion: shouldBeChampion, id: sol.id })
						.execute();
				} catch(err) { console.log('[score-recalc] Error updating focus/champion for sol ' + sol.id + ': ' + err); }
			}
		});

		console.log('[score-recalc] Completed for question ' + questionId);

	} catch (err) {
		console.log("[score-recalc] Critical Error: " + err);
	}
}
