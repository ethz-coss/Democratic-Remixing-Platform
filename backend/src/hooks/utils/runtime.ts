
function resolve() {
    var errors = require($filepath.join(__hooks, "utils", "errors.js"));
    var helpers = require($filepath.join(__hooks, "utils", "helpers.js"));
    var auth = require($filepath.join(__hooks, "utils", "auth.js"));
    var eligibility = require($filepath.join(__hooks, "utils", "eligibility.js"));


    return {
        err: errors.err,
        assert: errors.assert,
        tryCatch: errors.tryCatch,
        logHookError: errors.logHookError,
        logHookInfo: errors.logHookInfo,
        extractId: helpers.extractId,
        getReqData: helpers.getReqData,
        parseIsoTimestamp: helpers.parseIsoTimestamp,
        getCurrentQuestionPhase: helpers.getCurrentQuestionPhase,
        getQuestionPhaseTransition: helpers.getQuestionPhaseTransition,
        transitionQuestionPhase: helpers.transitionQuestionPhase,
        applyQuestionPhaseFields: helpers.applyQuestionPhaseFields,
        resolveQuestionPhase: helpers.resolveQuestionPhase,
        setQuestionPhase: helpers.setQuestionPhase,
        normalizeQuestionPhase: helpers.normalizeQuestionPhase,
        PHASE_PROPOSED: helpers.PHASE_PROPOSED,
        PHASE_IDEATION: helpers.PHASE_IDEATION,
        PHASE_SELECTION: helpers.PHASE_SELECTION,
        PHASE_FINAL_VOTE: helpers.PHASE_FINAL_VOTE,
        PHASE_ACTIVE_WORKSPACE: helpers.PHASE_ACTIVE_WORKSPACE,
        PHASE_FINAL_REPROPOSAL: helpers.PHASE_FINAL_REPROPOSAL,
        refreshQuestion: helpers.refreshQuestion,

        getAuth: auth.getAuth,
        reqAuth: auth.reqAuth,
        isInternal: auth.isInternal,
        isAdminAuth: auth.isAdminAuth,
        isSimulationAuth: auth.isSimulationAuth,
        isSimulationUserId: auth.isSimulationUserId,

        assertQuestionEligibility: eligibility.assertQuestionEligibility
    };
}

module.exports = {
    resolve: resolve
};
