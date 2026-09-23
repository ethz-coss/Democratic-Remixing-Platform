// backend/src/hooks/services/finalization-engine.ts

var phaseData = require($filepath.join(__hooks, "services", "phase-data.js"));

function finalizeAnswerSearch(txApp, questionId) {
    var d = require($filepath.join(__hooks, "utils", "runtime.js")).resolve();
    
    var question = txApp.findRecordById("questions", questionId);
    var isTest = question.getString("title").indexOf("[Fast Test]") >= 0;
    
    if (!isTest) {
        // 1. Set closing_window_ends_at (48 hours from now)
        var durationMs = 48 * 60 * 60 * 1000;
        var endsAt = new Date(Date.now() + durationMs).toISOString();
        question.set("closing_window_deadline", endsAt);
    }
    txApp.save(question);

    // 2. Transition phase
    phaseData.transitionQuestionPhase({
        question: question,
        nextPhase: phaseData.PHASE_CLOSING_WINDOW,
        transitionType: 'answer_search_elapsed',
        metadata: { reason: "answer_search_elapsed" }
    });
    
	d.logHookInfo("finalization_engine.closing_started", {
		questionId: questionId
	});
}

function finalizeClosingWindow(txApp, questionId) {
    var d = require($filepath.join(__hooks, "utils", "runtime.js")).resolve();
    
    // 1. Get all proposals in AnswerSearch/Closing phase states
    var proposals = txApp.findRecordsByFilter("proposals", "question = {:pid} && state = 'Proposed'", "", 1000, 0, { "pid": questionId }) || [];
    var champions = [];
    
    var pushEngine = require($filepath.join(__hooks, "services", "push-notifications-engine.js"));
    var pushTranslations = require($filepath.join(__hooks, "services", "push-translations.js")).pushTranslations;
    var ballotBatch = [];

    proposals.forEach(function(sol) {
        var inFocus = sol.get("in_focus");
        if (inFocus) {
            champions.push(sol.id);
            // Mark Focus ideas as FinalWinner
            sol.set("state", "FinalWinner");
            txApp.save(sol);

            // Notify supporters of this ballot entry
            try {
                var votes = txApp.findRecordsByFilter("proposal_votes", "proposal = {:pid} && vote > 0", "", 1000, 0, { "pid": sol.id }) || [];
                var proposalTitle = sol.getString("title") || "";
                
                var seen = {};
                votes.forEach(function(v) {
                    var voterId = d.extractId(v.get("user"));
                    if (voterId && !seen[voterId]) {
                        seen[voterId] = true;
                        
                        var userRecord = d.tryCatch(function() { return txApp.findRecordById("users", voterId); });
                        var lang = userRecord ? (userRecord.getString("language") || "en") : "en";
                        var texts = pushTranslations["ballot_entry"][lang] || pushTranslations["ballot_entry"]["en"];
                        
                        var title = texts.title;
                        var body = texts.body.replace("{proposalTitle}", proposalTitle);
                        
                        pushEngine.sendPushNotification(
                            "ballot_entry",
                            voterId,
                            sol.id,
                            {
                                title: title,
                                body: body,
                                data: { url: "/questions/" + questionId + "/proposals/" + sol.id }
                            },
                            ballotBatch
                        );
                    }
                });
            } catch (err) {
                console.log("[finalization-engine] Error processing ballot_entry pushes:", err);
            }
        } else {
            // Demote other ideas to Inactive
            sol.set("state", "Inactive");
            txApp.save(sol);
        }
    });

    if (ballotBatch.length > 0) {
        pushEngine.dispatchPushBatch(ballotBatch);
    }

    var question = txApp.findRecordById("questions", questionId);
    var isTest = question.getString("title").indexOf("[Fast Test]") >= 0;

    if (!isTest) {
        // 2. Set voting_window_ends_at (72 hours from now)
        var votingWindowDurationMs = 72 * 60 * 60 * 1000;
        var endsAt = new Date(Date.now() + votingWindowDurationMs).toISOString();
        question.set("vote_deadline", endsAt);
    }
    txApp.save(question);

    // 3. Transition phase
    phaseData.transitionQuestionPhase({
        question: question,
        nextPhase: phaseData.PHASE_FINAL_VOTE,
        transitionType: 'closing_window_elapsed',
        metadata: { 
            reason: "closing_window_elapsed",
            championsCount: champions.length
        }
    });
    
	d.logHookInfo("finalization_engine.finalized", {
		questionId: questionId,
		championsCount: champions.length
	});
}

function finalizeVoting(txApp, questionId) {
	var d = require($filepath.join(__hooks, "utils", "runtime.js")).resolve();
	var votingEngine = require($filepath.join(__hooks, "services", "voting-engine.js"));

	// 1. Get all ballot responses for this question
	var ballots = txApp.findRecordsByFilter("ballot_responses", "question = {:pid}", "", 10000, 0, { "pid": questionId }) || [];
	var parsedBallots = ballots.map(function(b) {
		var rawRanks = b.get("ranks");
		var ranks = [];
		try {
			if (typeof rawRanks === 'string') {
				ranks = JSON.parse(rawRanks);
			} else if (Array.isArray(rawRanks) && rawRanks.length > 0 && typeof rawRanks[0] === 'number') {
				// PocketBase returns JSON fields as Go byte slices → JS number arrays.
				// Decode UTF-8 bytes to string, then parse JSON.
				ranks = JSON.parse(decodeURIComponent(escape(String.fromCharCode.apply(null, rawRanks))));
			} else if (rawRanks) {
				// Convert Go slice to native JS array of objects in Goja
				ranks = JSON.parse(JSON.stringify(rawRanks));
			}
		} catch (e) {
			ranks = [];
		}
		
		var isAbstain = ranks.length === 0 || (ranks.length === 1 && ranks[0].proposalId === 'abstain');
		return {
			userId: b.get("user"),
			questionId: questionId,
			isAbstention: isAbstain,
			ranks: isAbstain ? [] : ranks
		};
	});

	// 2. Get champion proposals
	var proposals = txApp.findRecordsByFilter("proposals", "question = {:pid} && state = 'FinalWinner'", "", 1000, 0, { "pid": questionId }) || [];
	var championIds = proposals.map(function(p) { return p.id; });

	// 3. Calculate Borda results (now includes rankDistribution & maxPossibleScore)
	var results = votingEngine.calculateBordaResults(parsedBallots, championIds);

	// 4. Update Borda scores on proposals
	results.rankedProposals.forEach(function(score) {
		var sol = proposals.find(function(p) { return p.id === score.proposalId; });
		if (sol) {
			sol.set("borda_score", score.bordaScore);
			txApp.save(sol);
		}
	});

	// 5. Compute eligible voters from group membership (if question belongs to a group)
	var question = txApp.findRecordById("questions", questionId);
	var eligibleVoters = null;
	var groupId = question.get("group");
	if (groupId) {
		try {
			var members = txApp.findRecordsByFilter("group_members", "group = {:gid}", "", 100000, 0, { "gid": String(groupId) }) || [];
			eligibleVoters = members.length;
		} catch (e) {
			// not blocking — group may not be accessible
		}
	}

	// 6. Build and store voting_summary_json on the question record
	// This is publicly accessible aggregate data — no user-identifiable info
	var proposalSummaries = results.rankedProposals.map(function(score) {
		var sol = proposals.find(function(p) { return p.id === score.proposalId; });
		return {
			proposalId: score.proposalId,
			title: sol ? sol.get("title") : "",
			bordaScore: score.bordaScore,
			maxPossibleScore: score.maxPossibleScore,
			firstPlaceVotes: score.firstPlaceVotes,
			totalVotes: score.totalVotes,
			rankDistribution: score.rankDistribution
		};
	});

	var votingSummary = {
		totalBallots: results.totalBallots,
		activeVotes: results.totalBallots - results.abstentions,
		abstentions: results.abstentions,
		eligibleVoters: eligibleVoters,
		numChampions: results.numChampions,
		proposals: proposalSummaries
	};

	question.set("voting_summary_json", votingSummary);
	txApp.save(question);

	// 7. Transition to Decided phase
	phaseData.transitionQuestionPhase({
		question: question,
		nextPhase: phaseData.PHASE_DECIDED,
		transitionType: 'voting_window_elapsed',
		metadata: {
			reason: "voting_window_elapsed",
			totalBallots: results.totalBallots,
			abstentions: results.abstentions
		}
	});

	d.logHookInfo("finalization_engine.voting_finalized", {
		questionId: questionId,
		totalBallots: results.totalBallots
	});
}

module.exports = {
	finalizeAnswerSearch: finalizeAnswerSearch,
	finalizeClosingWindow: finalizeClosingWindow,
	finalizeVoting: finalizeVoting
};
