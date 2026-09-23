var errors = require($filepath.join(__hooks, "utils", "errors.js"));
var err = errors.err;
var tryCatch = errors.tryCatch;
var helpers = require($filepath.join(__hooks, "utils", "helpers.js"));

/**
 * Asserts that a user is eligible to interact with a question.
 * Throws ForbiddenError if the user is not eligible.
 *
 * Eligibility rules:
 *   - Public or empty visibility → everyone
 *   - Author of the question → always allowed
 *   - Group visibility → user must be a member of the question's group
 *   - Private visibility → only the author (already handled above)
 */
function assertQuestionEligibility(questionId, userId) {
    if (!questionId || !userId) return;

    // Admin users can access all questions
    var userRecord = tryCatch(function() { return $app.findRecordById('users', userId); }, null);
    if (userRecord && String(userRecord.get('role') || '') === 'admin') return;

    var question = tryCatch(function() {
        return $app.findRecordById("questions", questionId);
    }, null);
    if (!question) return; // question not found; let other hooks handle it

    var visibility = String(question.get("visibility") || "").trim();

    // Public or empty → everyone allowed
    if (!visibility || visibility === "Public") return;

    // Author always has access
    var author = helpers.extractId(question.get("author"));
    if (author && author === userId) return;

    if (visibility === "Group") {
        var groupId = helpers.extractId(question.get("group"));
        if (!groupId) {
            // Group visibility but no group assigned → treat as public
            return;
        }
        var membership = tryCatch(function() {
            return $app.findFirstRecordByFilter(
                "group_members",
                'group = {:gid} && user = {:uid}',
                { gid: groupId, uid: userId }
            );
        }, null);
        if (!membership) {
            err("You do not have access to this question.", ForbiddenError);
        }
        return;
    }

    if (visibility === "Private") {
        err("You do not have access to this question.", ForbiddenError);
        return;
    }
}


module.exports = {
    assertQuestionEligibility: assertQuestionEligibility
};
