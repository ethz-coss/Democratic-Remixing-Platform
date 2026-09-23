/// <reference path="./pocketbase-globals.d.ts" />

routerAdd("POST", "/api/custom/simulator/fast-forward/{questionId}", (e) => {
    var d = require($filepath.join(__hooks, "utils", "runtime.js")).resolve();
    var finalizationEngine = require($filepath.join(__hooks, 'services', 'finalization-engine.js'));

    var questionId = e.request.pathValue("questionId");
    var user = e.auth;
    
    if (!user) {
        throw new UnauthorizedError("Unauthorized");
    }

    var question = d.tryCatch(() => $app.findRecordById("questions", questionId));
    if (!question) {
        throw new NotFoundError("Question not found");
    }

    var isAuthor = question.get("author") === user.id;
    var isGroupAdmin = false;
    
    var groupId = question.get("group");
    if (groupId) {
        var group = d.tryCatch(() => $app.findRecordById("groups", groupId));
        if (group && group.get("author") === user.id) {
            isGroupAdmin = true;
        }
    }

    if (!isAuthor && !isGroupAdmin) {
        throw new ForbiddenError("Only the question author or group admin can fast forward phases.");
    }

    var phaseName = question.get("current_phase_name");
    
    // Create a past date to ensure deadline evaluation thinks it elapsed
    var pastDate = new Date(Date.now() - 1000).toISOString().replace('T', ' ');

    if (phaseName === 'AnswerSearch') {
        question.set('discussion_deadline', pastDate);
        $app.save(question);
        finalizationEngine.finalizeAnswerSearch($app, questionId);
    } else if (phaseName === 'Closing') {
        question.set('closing_window_deadline', pastDate);
        $app.save(question);
        finalizationEngine.finalizeClosingWindow($app, questionId);
    } else if (phaseName === 'Voting') {
        question.set('vote_deadline', pastDate);
        $app.save(question);
        finalizationEngine.finalizeVoting($app, questionId);
    } else {
        throw new BadRequestError("Cannot fast-forward this phase.");
    }

    return e.json(200, { ok: true, message: "Phase fast-forwarded successfully." });
});
