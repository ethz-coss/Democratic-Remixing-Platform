var errors = require($filepath.join(__hooks, "utils", "errors.js"));
var tryCatch = errors.tryCatch;
var phaseEngine = require($filepath.join(__hooks, "services", "phase-engine.js"));
var phaseData = require($filepath.join(__hooks, "services", "phase-data.js"));

// ─── Re-export phase constants & functions from phase-data ──────────────────
// Keeps backward compatibility for all consumers that import from helpers.

var PHASE_PROPOSED = phaseData.PHASE_PROPOSED;
var PHASE_IDEATION = phaseData.PHASE_IDEATION;
var PHASE_SELECTION = phaseData.PHASE_SELECTION;
var PHASE_FINAL_VOTE = phaseData.PHASE_FINAL_VOTE;
var PHASE_ACTIVE_WORKSPACE = phaseData.PHASE_ACTIVE_WORKSPACE;
var PHASE_FINAL_REPROPOSAL = phaseData.PHASE_FINAL_REPROPOSAL;

var normalizeQuestionPhase = phaseData.normalizeQuestionPhase;
var resolveQuestionPhase = phaseData.resolveQuestionPhase;
var getCurrentQuestionPhase = phaseData.getCurrentQuestionPhase;
var getQuestionPhaseTransition = phaseData.getQuestionPhaseTransition;
var transitionQuestionPhase = phaseData.transitionQuestionPhase;
var applyQuestionPhaseFields = phaseData.applyQuestionPhaseFields;
var setQuestionPhase = phaseData.setQuestionPhase;

// ─── Generic utilities (stay here) ──────────────────────────────────────────

function extractId(v) {
    var cur = v;
    var safety = 0;
    while (safety < 10) {
        safety += 1;
        if (!cur) return '';

        if (Array.isArray(cur)) {
            cur = cur.length > 0 ? cur[0] : '';
            continue;
        }

        if (typeof cur === 'object') {
            var getIdValue = (typeof cur.getId === 'function') ? tryCatch(function() {
                return cur.getId();
            }, null) : null;
            cur = cur.id || getIdValue || cur.value || '';
            continue;
        }

        if (typeof cur === 'string') {
            var t = cur.trim();
            var isArrayJson = t.length >= 2 && t.charAt(0) === '[' && t.charAt(t.length - 1) === ']';
            var isObjectJson = t.length >= 2 && t.charAt(0) === '{' && t.charAt(t.length - 1) === '}';
            if (isArrayJson || isObjectJson) {
                var parsed = tryCatch(function() {
                    return JSON.parse(t);
                }, null);
                if (parsed !== null && parsed !== undefined) {
                    cur = parsed;
                    continue;
                }
            }
            return t;
        }

        return String(cur).trim();
    }

    return '';
}

function getReqData(e) {
    return tryCatch(function() {
        var reqInfo = e.requestInfo ? e.requestInfo() : null;
        return reqInfo && reqInfo.data ? reqInfo.data : null;
    }) || {};
}

function parseIsoTimestamp(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';

    var normalized = raw;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        normalized = raw + 'T00:00:00.000Z';
    }

    var epoch = Date.parse(normalized);
    if (!isFinite(epoch)) return '';
    return new Date(epoch).toISOString();
}

// ─── Question / Proposal score refresh ───────────────────────────────────────

var GLOBAL_QUESTION_ACTIVATION_THRESHOLD = 10;

function refreshQuestion(questionId) {
    if (!questionId) return;
    tryCatch(function() {
        var question = $app.findRecordById('questions', questionId);
        var prevStatus = getCurrentQuestionPhase(question) || PHASE_PROPOSED;
        var result = new DynamicModel({ "score": 0 });
        $app.db().newQuery("SELECT COALESCE(SUM(vote), 0) as score FROM question_votes WHERE question = {:id}")
            .bind({ id: questionId })
            .one(result);
        var score = Number(result.score || 0);

        var activation = phaseEngine.evaluateActivationTransition({
            currentPhase: prevStatus,
            score: score,
            activationThreshold: GLOBAL_QUESTION_ACTIVATION_THRESHOLD
        });
        var nextStatus = activation.nextPhase;
        if (activation.reason !== 'unchanged_locked_phase') {
            var transitionResult = transitionQuestionPhase({
                question: question,
                nextPhase: nextStatus,
                transitionType: 'question_vote_refresh',
                sourceRecordId: questionId,
                metadata: {
                    score: score,
                    threshold: GLOBAL_QUESTION_ACTIVATION_THRESHOLD,
                    decisionReason: activation.reason
                }
            });
            errors.logHookInfo('helpers.refresh_question.transition_result', {
                questionId: String(questionId || ''),
                targetPhase: String(nextStatus || ''),
                changed: transitionResult && transitionResult.changed === true,
                reason: String(transitionResult && transitionResult.reason || ''),
                currentPhase: String(transitionResult && transitionResult.currentPhase || ''),
                nextPhase: String(transitionResult && transitionResult.nextPhase || ''),
                phaseRecordId: String(transitionResult && transitionResult.phaseRecordId || ''),
                assertionTargetMatches: String(transitionResult && transitionResult.nextPhase || '') === String(nextStatus || ''),
                assertionRaceNoopAllowed:
                    String(transitionResult && transitionResult.reason || '') === 'already_open_phase_record' ||
                    String(transitionResult && transitionResult.reason || '') === 'already_in_phase'
            });
            if (
                String(transitionResult && transitionResult.nextPhase || '') !== String(nextStatus || '') &&
                String(transitionResult && transitionResult.reason || '') !== 'already_open_phase_record' &&
                String(transitionResult && transitionResult.reason || '') !== 'already_in_phase'
            ) {
                errors.logHookError('helpers.refresh_question.transition_assertion_failed', new Error('phase transition target mismatch'), {
                    questionId: String(questionId || ''),
                    targetPhase: String(nextStatus || ''),
                    transitionReason: String(transitionResult && transitionResult.reason || ''),
                    transitionNextPhase: String(transitionResult && transitionResult.nextPhase || '')
                });
            }
        }

    });
}

/**
 * Safely parse a PocketBase multi-relation field into an array of ID strings.
 * PocketBase may store these as a JSON string, a plain array, or empty/null.
 */
function parseJsonArray(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val.map(function(v) { return String(v); });
    if (typeof val === 'string') {
        var t = val.trim();
        if (t.charAt(0) === '[') {
            var parsed = tryCatch(function() { return JSON.parse(t); }, null);
            if (Array.isArray(parsed)) return parsed.map(function(v) { return String(v); });
        }
        // Single ID string
        if (t) return [t];
    }
    return [];
}

module.exports = {
    extractId: extractId,
    getReqData: getReqData,
    parseIsoTimestamp: parseIsoTimestamp,
    parseJsonArray: parseJsonArray,
    getCurrentQuestionPhase: getCurrentQuestionPhase,
    getQuestionPhaseTransition: getQuestionPhaseTransition,
    transitionQuestionPhase: transitionQuestionPhase,
    applyQuestionPhaseFields: applyQuestionPhaseFields,
    resolveQuestionPhase: resolveQuestionPhase,
    setQuestionPhase: setQuestionPhase,
    normalizeQuestionPhase: normalizeQuestionPhase,
    PHASE_PROPOSED: PHASE_PROPOSED,
    PHASE_FINAL_VOTE: PHASE_FINAL_VOTE,
    refreshQuestion: refreshQuestion
};
