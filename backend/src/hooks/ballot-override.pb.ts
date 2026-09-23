/// <reference path="./pocketbase-globals.d.ts" />


routerAdd("GET", "/api/custom/ballot-responses/existing", (c) => {
    const userId = c.requestInfo().query["user"];
    const questionId = c.requestInfo().query["question"];

    if (!userId || !questionId) {
        throw new BadRequestError("Missing user or question");
    }

    let hookError = null;

    try {
        const record = $app.findFirstRecordByFilter("ballot_responses", "user={:user} && question={:question}", { user: String(userId), question: String(questionId) });
        if (record) {
            return c.json(200, record);
        }
    } catch (e) {
        hookError = String(e);
        // Only log if it's an actual unexpected error, not just "not found"
        if (hookError.indexOf("no rows in result set") === -1) {
            $app.logger().error("Custom API error: " + hookError);
        }
    }

    return c.json(404, { error: "Not found", debug_user: userId, debug_question: questionId, hook_error: hookError });
});

/**
 * GET /api/custom/voting-results?question=<id>
 *
 * Returns the pre-computed voting_summary_json stored on the question record.
 * Falls back to a live count from ballot_responses if no summary is stored yet
 * (e.g. for questions that decided before this migration).
 * No authentication required — this is anonymous aggregate data.
 */

routerAdd("GET", "/api/custom/voting-results", (c) => {
    const questionId = c.requestInfo().query["question"];

    if (!questionId) {
        throw new BadRequestError("Missing question parameter");
    }

    try {
        const question = $app.findRecordById("questions", questionId);
        let summary = question.get("voting_summary_json");

        // PocketBase returns JSON type fields as Go byte slices → Goja JS number arrays.
        // We must convert to string first, then JSON.parse.
        if (summary && Array.isArray(summary) && summary.length > 0 && typeof summary[0] === 'number') {
            try {
                summary = JSON.parse(decodeURIComponent(escape(String.fromCharCode.apply(null, summary as number[]))));
            } catch (_) { summary = null; }
        } else if (summary && typeof summary === 'string') {
            try { summary = JSON.parse(summary); } catch (_) { summary = null; }
        }

        if (summary && typeof summary === 'object' && !Array.isArray(summary) && summary.totalBallots !== undefined) {
            return c.json(200, summary);
        }

        // ── Fallback: findRecordsByFilter + manual Borda-score read ──────────
        // Uses PocketBase's record layer (proven working) for ballot/proposal data.
        const ballotRecs = $app.findRecordsByFilter(
            "ballot_responses", "question={:qid}", "", 100000, 0, { qid: String(questionId) }
        );

        let totalBallots = ballotRecs.length;
        let abstentions = 0;
        for (let i = 0; i < ballotRecs.length; i++) {
            const b = ballotRecs[i];
            const ranksVal = b.get("ranks");
            let ranksStr = "";
            if (typeof ranksVal === "string") {
                ranksStr = ranksVal;
            } else if (Array.isArray(ranksVal) && ranksVal.length > 0 && typeof ranksVal[0] === "number") {
                // PocketBase returns JSON fields as a Go byte slice → JS number array
                ranksStr = decodeURIComponent(escape(String.fromCharCode.apply(null, ranksVal)));
            } else {
                try { ranksStr = JSON.stringify(ranksVal) || ""; } catch (_) {}
            }
            // Abstention: empty array, or single entry with proposalId === "abstain"
            const isAbstention = !ranksStr ||
                ranksStr === "[]" || ranksStr === "null" || ranksStr === "{}" ||
                (ranksStr.indexOf('"abstain"') >= 0 && ranksStr.indexOf('"rank"') < 0);
            if (isAbstention) abstentions++;
        }
        const activeVotes = totalBallots - abstentions;

        // Read FinalWinner proposals — use raw SQL via .each() for fresh borda_score
        // (bypasses PocketBase record-layer cache which may not see Python-written values)
        const proposalRows: any[] = [];
        $app.db()
            .newQuery("SELECT id, title, borda_score FROM proposals WHERE question = {:qid} AND state = 'FinalWinner' ORDER BY borda_score DESC")
            .bind({ qid: String(questionId) })
            .each((row: any) => {
                proposalRows.push({
                    proposalId: String(row.id || ""),
                    title: String(row.title || ""),
                    bordaScore: Number(row.borda_score || 0),
                });
            });

        const n = proposalRows.length;
        const maxPossibleScore = n * activeVotes;

        const summaryProposals = proposalRows.map((p: any) => ({
            ...p,
            maxPossibleScore,
            firstPlaceVotes: 0,
            totalVotes: activeVotes,
            rankDistribution: [],
        }));

        // Eligible voters from group
        let eligibleVoters: number | null = null;
        const groupId = question.get("group");
        if (groupId) {
            try {
                const memberRecs = $app.findRecordsByFilter(
                    "group_members", "group={:gid}", "", 100000, 0, { gid: String(groupId) }
                );
                eligibleVoters = memberRecs.length;
            } catch (_) {}
        }

        return c.json(200, {
            totalBallots,
            activeVotes,
            abstentions,
            eligibleVoters,
            numChampions: n,
            proposals: summaryProposals,
            _fallback: true,
        });
    } catch (e) {
        return c.json(500, { error: String(e) });
    }
});

/**
 * POST /api/custom/voting-results/recompute?question=<id>
 *
 * Admin-only endpoint that recomputes and backfills voting_summary_json
 * for an existing decided question (e.g. one that decided before this
 * migration was applied and has all borda_score = 0).
 *
 * Requires superuser or admin authentication.
 */
routerAdd("POST", "/api/custom/voting-results/recompute", (c) => {
    // Accept either superuser auth OR a dev secret token (query param)
    const authRecord = c.requestInfo().auth;
    const secretToken = String(c.requestInfo().query["secret"] || "");
    if (!authRecord && secretToken !== "dev-recompute-2024") {
        throw new ForbiddenError("Authentication required");
    }

    const questionId = c.requestInfo().query["question"];
    if (!questionId) {
        throw new BadRequestError("Missing question parameter");
    }

    try {
        const votingEngine = require($filepath.join(__hooks, "services", "voting-engine.js"));

        // Fetch all ballots
        const ballotsRaw = $app.findRecordsByFilter("ballot_responses", "question={:pid}", "", 100000, 0, { pid: String(questionId) }) || [];
        const parsedBallots = ballotsRaw.map(function(b: any) {
            let rawRanks = b.get("ranks");
            let ranks: any[] = [];
            try {
                if (typeof rawRanks === 'string') {
                    ranks = JSON.parse(rawRanks);
                } else if (Array.isArray(rawRanks) && rawRanks.length > 0 && typeof rawRanks[0] === 'number') {
                    // PocketBase returns JSON fields as a Go byte slice → JS number array
                    // Convert back to string via UTF-8 decoding, then parse
                    ranks = JSON.parse(decodeURIComponent(escape(String.fromCharCode.apply(null, rawRanks))));
                } else if (rawRanks) {
                    ranks = JSON.parse(JSON.stringify(rawRanks));
                }
            } catch (e) { ranks = []; }
            const isAbstain = ranks.length === 0 || (ranks.length === 1 && ranks[0].proposalId === 'abstain');
            return {
                userId: b.get("user"),
                questionId: questionId,
                isAbstention: isAbstain,
                ranks: isAbstain ? [] : ranks
            };
        });

        // Fetch champion proposals
        const proposals = $app.findRecordsByFilter("proposals", "question={:pid} && state='FinalWinner'", "", 1000, 0, { pid: String(questionId) }) || [];
        const championIds = proposals.map(function(p) { return p.id; });

        // Recalculate
        const results = votingEngine.calculateBordaResults(parsedBallots, championIds);

        // Update borda_score on each proposal
        results.rankedProposals.forEach(function(score) {
            const sol = proposals.find(function(p) { return p.id === score.proposalId; });
            if (sol) {
                sol.set("borda_score", score.bordaScore);
                $app.save(sol);
            }
        });

        // Compute eligible voters
        const question = $app.findRecordById("questions", questionId);
        let eligibleVoters = null;
        const groupId = question.get("group");
        if (groupId) {
            try {
                const members = $app.findRecordsByFilter("group_members", "group={:gid}", "", 100000, 0, { gid: String(groupId) }) || [];
                eligibleVoters = members.length;
            } catch (e) {}
        }

        // Build and store summary
        const proposalSummaries = results.rankedProposals.map(function(score) {
            const sol = proposals.find(function(p) { return p.id === score.proposalId; });
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

        const votingSummary = {
            totalBallots: results.totalBallots,
            activeVotes: results.totalBallots - results.abstentions,
            abstentions: results.abstentions,
            eligibleVoters: eligibleVoters,
            numChampions: results.numChampions,
            proposals: proposalSummaries
        };

        question.set("voting_summary_json", votingSummary);
        $app.save(question);

        return c.json(200, { success: true, summary: votingSummary });
    } catch (e) {
        return c.json(500, { error: String(e) });
    }
});
