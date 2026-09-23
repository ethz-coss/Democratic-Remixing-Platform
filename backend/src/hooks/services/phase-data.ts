/**
 * phase-data.ts — Data layer for question phase records.
 *
 * Responsibilities:
 *   - Creating / closing `question_phases` records in PocketBase.
 *   - Reading / resolving the current phase of a question.
 *   - Applying denormalised phase fields on the `questions` record.
 *   - Normalising legacy phase name aliases to canonical names.
 *
 * This module intentionally contains $app calls. It is the persistence
 * counterpart to `phase-engine.ts` (which is pure logic, no DB access).
 */

var errors = require($filepath.join(__hooks, "utils", "errors.js"));
var tryCatch = errors.tryCatch;
var phaseEngine = require($filepath.join(__hooks, "services", "phase-engine.js"));

// ─── Phase constants (fluid workspace model) ───────────────────────────────

var PHASE_PROPOSED = 'Proposed';
var PHASE_ACTIVE_WORKSPACE = 'AnswerSearch';
var PHASE_CLOSING_WINDOW = 'Closing';
var PHASE_FINAL_VOTE = 'Voting';
var PHASE_DECIDED = 'Decided';

// Legacy aliases — kept for backward compat in hooks/migrations that still reference them
var PHASE_IDEATION = 'ActiveWorkspace';
var PHASE_MAPPING = 'ActiveWorkspace';
var PHASE_EXPLORATION = 'ActiveWorkspace';
var PHASE_FINAL_REPROPOSAL = 'FinalVote';

// ─── Name normalisation ─────────────────────────────────────────────────────

function normalizeQuestionPhase(value) {
    var raw = String(value || '').trim();
    if (!raw) return PHASE_PROPOSED;

    if (raw === 'Proposed' || raw === 'ProposedQuestion' || raw === 'Proposed_Question') {
        return PHASE_PROPOSED;
    }
    // Canonical fluid phase
    if (raw === 'AnswerSearch' || raw === 'ActiveWorkspace') {
        return PHASE_ACTIVE_WORKSPACE;
    }
    // Legacy phases all map to ActiveWorkspace
    if (raw === 'Ideation' || raw === 'ActiveIdeation' || raw === 'Active_Ideation' || raw === 'Salvage_Improve') {
        return PHASE_ACTIVE_WORKSPACE;
    }
    if (raw === 'Mapping' || raw === 'Selection' || raw === 'SelectionPhase' || raw === 'Structure') {
        return PHASE_ACTIVE_WORKSPACE;
    }
    if (raw === 'Exploration') {
        return PHASE_ACTIVE_WORKSPACE;
    }
    // Canonical closing window
    if (raw === 'Closing' || raw === 'ClosingWindow' || raw === 'Closing_Window' || raw === 'closing_window') {
        return PHASE_CLOSING_WINDOW;
    }
    // Canonical final vote phase
    if (raw === 'Voting' || raw === 'FinalVote') {
        return PHASE_FINAL_VOTE;
    }
    // Legacy terminal phase maps to FinalVote
    if (raw === 'FinalReproposal' || raw === 'FinalResolution' || raw === 'Resolved_Voting') {
        return PHASE_FINAL_VOTE;
    }
    // Decided phase
    if (raw === 'Decided') {
        return PHASE_DECIDED;
    }

    return PHASE_PROPOSED;
}

// ─── Resolve current phase from a question record ────────────────────────────

function extractId(v) {
    // Thin re-import to avoid circular deps at module-load time.
    var helpers = require($filepath.join(__hooks, "utils", "helpers.js"));
    return helpers.extractId(v);
}

function parseIsoTimestamp(value) {
    var helpers = require($filepath.join(__hooks, "utils", "helpers.js"));
    return helpers.parseIsoTimestamp(value);
}

function resolveQuestionPhase(question) {
    if (!question) return '';

    var explicitPhase = String(question.get('current_phase_name') || '').trim();
    if (explicitPhase) return normalizeQuestionPhase(explicitPhase);

    var currentPhaseId = extractId(question.get('current_phase'));
    if (currentPhaseId) {
        var currentPhase = tryCatch(function() {
            return $app.findRecordById('question_phases', currentPhaseId);
        }, null);
        var relatedPhaseName = currentPhase ? String(currentPhase.get('phase_name') || '').trim() : '';
        if (relatedPhaseName) return normalizeQuestionPhase(relatedPhaseName);
    }

    return normalizeQuestionPhase(question.get('status'));
}

function getCurrentQuestionPhase(question) {
    return resolveQuestionPhase(question);
}

// ─── Phase record helpers ───────────────────────────────────────────────────

function getPhaseRecordById(phaseId) {
    if (!phaseId) return null;
    return tryCatch(function() {
        return $app.findRecordById('question_phases', phaseId);
    }, null);
}

function getLatestOpenQuestionPhase(questionId) {
    if (!questionId) return null;
    var open = tryCatch(function() {
        return $app.findRecordsByFilter(
            'question_phases',
            'question = {:id} && ended_at = ""',
            '-started_at,-created,-id',
            1,
            0,
            { id: questionId }
        ) || [];
    }, []);
    if (open.length > 0) return open[0];

    var latest = tryCatch(function() {
        return $app.findRecordsByFilter(
            'question_phases',
            'question = {:id}',
            '-started_at,-created,-id',
            1,
            0,
            { id: questionId }
        ) || [];
    }, []);
    return latest.length > 0 ? latest[0] : null;
}

// ─── Apply denormalised phase fields on question ─────────────────────────────

function applyQuestionPhaseFields(question, phaseName, phaseRecordId) {
    if (!question) return;
    var nextPhase = normalizeQuestionPhase(phaseName);
    if (!nextPhase) return;

    tryCatch(function() {
        question.set('current_phase_name', nextPhase);
    });
    tryCatch(function() {
        question.set('status', nextPhase);
    });
    if (phaseRecordId !== undefined) {
        tryCatch(function() {
            question.set('current_phase', phaseRecordId || null);
        });
    }
}

// ─── Transition check (delegates to phase-engine) ───────────────────────────

function getQuestionPhaseTransition(input) {
    var payload = input || {};
    var currentPhase = normalizeQuestionPhase(payload.currentPhase || payload.fromPhase || PHASE_PROPOSED);
    var nextPhase = normalizeQuestionPhase(payload.nextPhase || payload.toPhase || PHASE_PROPOSED);
    return phaseEngine.evaluateTransition({
        currentPhase: currentPhase,
        nextPhase: nextPhase,
        force: payload.force === true,
        allowNoop: payload.allowNoop === true
    });
}

// ─── Core transition function ───────────────────────────────────────────────

/**
 * transitionQuestionPhase — the single authoritative function that:
 *   1. Validates the transition via phase-engine.
 *   2. Closes the current question_phases record (sets ended_at).
 *   3. Creates a new question_phases record for the next phase.
 *   4. Updates the question's denormalised current_phase / current_phase_name.
 */
function transitionQuestionPhase(input) {
    var payload = input || {};
    var question = payload.question || null;
    var questionId = String(payload.questionId || '').trim();
    if (!question && questionId) {
        question = tryCatch(function() {
            return $app.findRecordById('questions', questionId);
        }, null);
    }
    if (!question) {
        return {
            changed: false,
            reason: 'question_not_found'
        };
    }

    questionId = String(question.id || questionId || '').trim();
    var currentPhase = resolveQuestionPhase(question) || PHASE_PROPOSED;
    var nextPhase = normalizeQuestionPhase(payload.nextPhase || payload.phaseName || currentPhase);
    var transitionCheck = getQuestionPhaseTransition({
        currentPhase: currentPhase,
        nextPhase: nextPhase,
        force: payload.force === true,
        allowNoop: payload.allowNoop === true
    });

    if (!transitionCheck.allowed && transitionCheck.reason !== 'same_phase') {
        return {
            changed: false,
            reason: transitionCheck.reason,
            currentPhase: currentPhase,
            nextPhase: nextPhase
        };
    }

    if (transitionCheck.reason === 'same_phase' && payload.allowNoop !== true) {
        return {
            changed: false,
            reason: 'already_in_phase',
            currentPhase: currentPhase,
            nextPhase: nextPhase
        };
    }

    if (!questionId) {
        applyQuestionPhaseFields(question, nextPhase, undefined);
        return {
            changed: currentPhase !== nextPhase,
            reason: 'phase_fields_updated_only',
            currentPhase: currentPhase,
            nextPhase: nextPhase,
            phaseRecordId: ''
        };
    }

    var startedAt = parseIsoTimestamp(payload.occurredAt || payload.startedAt) || new Date().toISOString();
    var previousPhase = null;
    var currentPhaseId = extractId(question.get('current_phase'));
    if (currentPhaseId) {
        previousPhase = getPhaseRecordById(currentPhaseId);
    }
    if (!previousPhase) {
        previousPhase = getLatestOpenQuestionPhase(questionId);
    }

    if (previousPhase) {
        var previousName = normalizeQuestionPhase(previousPhase.get('phase_name'));
        var previousEndedAt = String(previousPhase.get('ended_at') || '').trim();
        if (previousName === nextPhase && !previousEndedAt && payload.force !== true) {
            applyQuestionPhaseFields(question, nextPhase, previousPhase.id);
            tryCatch(function() {
                question.set('__is_transition', true);
                $app.save(question);
            });
            return {
                changed: false,
                reason: 'already_open_phase_record',
                currentPhase: currentPhase,
                nextPhase: nextPhase,
                phaseRecordId: String(previousPhase.id || '')
            };
        }
    }

    var phaseCollection = tryCatch(function() {
        return $app.findCollectionByNameOrId('question_phases');
    }, null);
    if (!phaseCollection) {
        applyQuestionPhaseFields(question, nextPhase, undefined);
        tryCatch(function() {
            $app.save(question);
        });
        return {
            changed: currentPhase !== nextPhase,
            reason: 'question_phases_collection_missing',
            currentPhase: currentPhase,
            nextPhase: nextPhase,
            phaseRecordId: ''
        };
    }

    if (previousPhase) {
        var maybeEndedAt = String(previousPhase.get('ended_at') || '').trim();
        if (!maybeEndedAt) {
            previousPhase.set('ended_at', startedAt);
            tryCatch(function() {
                $app.save(previousPhase);
            });
        }
    }

    var phaseRecord = new Record(phaseCollection);
    phaseRecord.set('question', questionId);
    phaseRecord.set('phase_name', nextPhase);
    phaseRecord.set('started_at', startedAt);
    phaseRecord.set('ended_at', '');
    phaseRecord.set('previous_phase', previousPhase ? String(previousPhase.id || '') : null);
    phaseRecord.set('transition_type', String(payload.transitionType || '').trim());
    phaseRecord.set('transition_metadata_json', payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : null);
    phaseRecord.set('source_record_id', String(payload.sourceRecordId || '').trim());
    $app.save(phaseRecord);

    applyQuestionPhaseFields(question, nextPhase, phaseRecord.id);
    question.set('__is_transition', true);
    $app.save(question);
    return {
        changed: currentPhase !== nextPhase,
        reason: 'transitioned',
        currentPhase: currentPhase,
        nextPhase: nextPhase,
        phaseRecordId: String(phaseRecord.id || '')
    };
}

// ─── Transition telemetry (consolidated from duplicate copies) ───────────────

function logPhaseTransitionTelemetry(d, scope, questionId, targetPhase, transitionResult, extra) {
    var result = transitionResult || {};
    var payload = {
        questionId: String(questionId || ""),
        targetPhase: String(targetPhase || ""),
        changed: result.changed === true,
        reason: String(result.reason || ""),
        currentPhase: String(result.currentPhase || ""),
        nextPhase: String(result.nextPhase || ""),
        phaseRecordId: String(result.phaseRecordId || ""),
        assertionTargetMatches: String(result.nextPhase || "") === String(targetPhase || ""),
        assertionRaceNoopAllowed: String(result.reason || "") === "already_open_phase_record" || String(result.reason || "") === "already_in_phase"
    };
    if (extra && typeof extra === "object") {
        Object.keys(extra).forEach(function(key) {
            payload[key] = extra[key];
        });
    }
    d.logHookInfo(scope + ".transition_result", payload);

    if (!payload.assertionTargetMatches && !payload.assertionRaceNoopAllowed) {
        d.logHookError(scope + ".transition_assertion_failed", new Error("phase transition target mismatch"), payload);
    }
    return result;
}

// ─── Legacy compat ──────────────────────────────────────────────────────────

function setQuestionPhase(question, phaseName) {
    applyQuestionPhaseFields(question, phaseName, undefined);
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    // Canonical constants (fluid workspace model)
    PHASE_PROPOSED: PHASE_PROPOSED,
    PHASE_ACTIVE_WORKSPACE: PHASE_ACTIVE_WORKSPACE,
    PHASE_CLOSING_WINDOW: PHASE_CLOSING_WINDOW,
    PHASE_FINAL_VOTE: PHASE_FINAL_VOTE,
    PHASE_DECIDED: PHASE_DECIDED,
    PHASE_FINAL_REPROPOSAL: PHASE_FINAL_VOTE, // legacy alias compat
    // Legacy aliases — all point to canonical phases for backward compat
    PHASE_IDEATION: PHASE_IDEATION,
    PHASE_MAPPING: PHASE_MAPPING,
    PHASE_EXPLORATION: PHASE_EXPLORATION,
    PHASE_STRUCTURE: PHASE_MAPPING,
    PHASE_SELECTION: PHASE_MAPPING,
    // Pure helpers
    normalizeQuestionPhase: normalizeQuestionPhase,
    // DB-backed helpers
    resolveQuestionPhase: resolveQuestionPhase,
    getCurrentQuestionPhase: getCurrentQuestionPhase,
    getPhaseRecordById: getPhaseRecordById,
    getLatestOpenQuestionPhase: getLatestOpenQuestionPhase,
    applyQuestionPhaseFields: applyQuestionPhaseFields,
    setQuestionPhase: setQuestionPhase,
    getQuestionPhaseTransition: getQuestionPhaseTransition,
    // Core transition
    transitionQuestionPhase: transitionQuestionPhase,
    // Telemetry
    logPhaseTransitionTelemetry: logPhaseTransitionTelemetry
};
