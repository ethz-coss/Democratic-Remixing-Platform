/// <reference path="./pocketbase-globals.d.ts" />

onRecordCreateRequest((e: any) => {
    const d = require($filepath.join(__hooks, "utils", "runtime.js")).resolve();
    if (d.isAdminAuth(e)) {
        e.next();
        return;
    }
    const auth = d.getAuth(e);
    const vote = Number(e.record.get('vote'));
    d.assert((vote === 0 || vote === 1) && Math.round(vote) === vote, 'Vote must be 0 or 1.');

    const user = d.extractId(e.record.get('user'));
    const isAppUserAuth = !!(auth && auth.collectionName === 'users');
    if (isAppUserAuth) {
        d.assert(!user || user === auth.id, 'You can only interact with your own vote.', ForbiddenError);
        e.record.set('user', auth.id);
    } else {
        d.assert(user, 'Vote user is required.');
    }

    const reqData = d.getReqData(e);
    const requestedOccurredAt = reqData.occurred_at ? d.parseIsoTimestamp(reqData.occurred_at) : null;
    const canOverrideTimestamp = d.isInternal(e) || d.isSimulationAuth(e) || d.isSimulationUserId(user);
    if (requestedOccurredAt) {
        d.assert(canOverrideTimestamp, 'Custom timestamps are only allowed for simulation/internal requests.', BadRequestError);
    }
    const effectiveOccurredAt = requestedOccurredAt || e.record.get('occurred_at') || new Date().toISOString();
    e.record.set('occurred_at', effectiveOccurredAt);

    // Group-based access control
    const pvQuestionId = d.extractId(e.record.get('question'));
    if (pvQuestionId && isAppUserAuth) {
        d.assertQuestionEligibility(pvQuestionId, auth.id);
    }

    e.next();
}, "question_votes");

onRecordUpdateRequest((e: any) => {
    const d = require($filepath.join(__hooks, "utils", "runtime.js")).resolve();
    if (d.isAdminAuth(e)) {
        e.next();
        return;
    }
    const auth = d.getAuth(e);
    const vote = Number(e.record.get('vote'));
    d.assert((vote === 0 || vote === 1) && Math.round(vote) === vote, 'Vote must be 0 or 1.');

    const user = d.extractId(e.record.get('user'));
    const isAppUserAuth = !!(auth && auth.collectionName === 'users');
    if (isAppUserAuth) {
        d.assert(!user || user === auth.id, 'You can only interact with your own vote.', ForbiddenError);
        e.record.set('user', auth.id);
    } else {
        d.assert(user, 'Vote user is required.');
    }

    const reqData = d.getReqData(e);
    const requestedOccurredAt = reqData.occurred_at ? d.parseIsoTimestamp(reqData.occurred_at) : null;
    const canOverrideTimestamp = d.isInternal(e) || d.isSimulationAuth(e) || d.isSimulationUserId(user);
    if (requestedOccurredAt) {
        d.assert(canOverrideTimestamp, 'Custom timestamps are only allowed for simulation/internal requests.', BadRequestError);
    }
    const effectiveOccurredAt = requestedOccurredAt || e.record.get('occurred_at') || new Date().toISOString();
    e.record.set('occurred_at', effectiveOccurredAt);

    e.next();
}, "question_votes");

onRecordCreateRequest((e: any) => {
    const d = require($filepath.join(__hooks, "utils", "runtime.js")).resolve();
    if (d.isAdminAuth(e)) {
        e.next();
        return;
    }
    const auth = d.reqAuth(e);
    const vote = Number(e.record.get('vote'));
    d.assert(vote === 0 || vote === 1, 'Vote must be 0 (retract) or 1 (support).');

    const reqData = d.getReqData(e);
    const solId = d.extractId(e.record.get('proposal')) || d.extractId(reqData.proposal);
    d.assert(solId, 'Proposal is required.');
    e.record.set('proposal', solId);

    // Denormalize question from proposal for efficient aggregation
    let questionId = d.extractId(e.record.get('question')) || d.extractId(reqData.question);
    if (!questionId) {
        const sol = d.tryCatch(() => $app.findRecordById('proposals', solId));
        if (sol) {
            questionId = d.extractId(sol.get('question'));
        }
    }
    if (questionId) {
        e.record.set('question', questionId);
        const question = d.tryCatch(() => $app.findRecordById('questions', questionId));
        if (question) {
            const phase = d.getCurrentQuestionPhase(question);
            d.assert(phase !== d.PHASE_FINAL_VOTE, 'Voting is locked for this question (Final Vote phase).', BadRequestError);
        }
    }

    const user = d.extractId(e.record.get('user'));
    const isAppUserAuth = !!(auth && auth.collectionName === 'users');
    if (isAppUserAuth) {
        d.assert(!user || user === auth.id, 'You can only interact with your own vote.', ForbiddenError);
        e.record.set('user', auth.id);
    } else {
        d.assert(user, 'Vote user is required.');
    }

    const requestedOccurredAt = reqData.occurred_at ? d.parseIsoTimestamp(reqData.occurred_at) : null;
    const canOverrideTimestamp = d.isInternal(e) || d.isSimulationAuth(e) || d.isSimulationUserId(user);
    if (requestedOccurredAt) {
        d.assert(canOverrideTimestamp, 'Custom timestamps are only allowed for simulation/internal requests.', BadRequestError);
    }
    const effectiveOccurredAt = requestedOccurredAt || e.record.get('occurred_at') || new Date().toISOString();
    e.record.set('occurred_at', effectiveOccurredAt);

    // Group-based access control
    if (questionId && isAppUserAuth) {
        d.assertQuestionEligibility(questionId, auth.id);
    }

    e.next();
}, "proposal_votes");

onRecordUpdateRequest((e: any) => {
    const d = require($filepath.join(__hooks, "utils", "runtime.js")).resolve();
    if (d.isAdminAuth(e)) {
        e.next();
        return;
    }
    const auth = d.reqAuth(e);
    const vote = Number(e.record.get('vote'));
    d.assert(vote === 0 || vote === 1, 'Vote must be 0 (retract) or 1 (support).');

    const persisted = d.tryCatch(() => $app.findRecordById('proposal_votes', e.record.id));
    d.assert(persisted, 'Vote not found.');

    const persistedSolId = d.extractId(persisted.get('proposal'));
    d.assert(persistedSolId, 'Proposal is required.');

    const incomingSolId = d.extractId(e.record.get('proposal'));
    d.assert(!incomingSolId || incomingSolId === persistedSolId, 'Proposal cannot be changed after vote creation.', ForbiddenError);
    e.record.set('proposal', persistedSolId);

    // Preserve question denormalization
    const persistedQuestionId = d.extractId(persisted.get('question'));
    if (persistedQuestionId) {
        e.record.set('question', persistedQuestionId);
        const question = d.tryCatch(() => $app.findRecordById('questions', persistedQuestionId));
        if (question) {
            const phase = d.getCurrentQuestionPhase(question);
            d.assert(phase !== d.PHASE_FINAL_VOTE, 'Voting is locked for this question (Final Vote phase).', BadRequestError);
        }
    }

    const user = d.extractId(e.record.get('user')) || d.extractId(persisted.get('user'));
    const isAppUserAuth = !!(auth && auth.collectionName === 'users');
    if (isAppUserAuth) {
        d.assert(!user || user === auth.id, 'You can only interact with your own vote.', ForbiddenError);
        e.record.set('user', auth.id);
    } else {
        d.assert(user, 'Vote user is required.');
    }

    const reqData = d.getReqData(e);
    const requestedOccurredAt = reqData.occurred_at ? d.parseIsoTimestamp(reqData.occurred_at) : null;
    const canOverrideTimestamp = d.isInternal(e) || d.isSimulationAuth(e) || d.isSimulationUserId(user);
    if (requestedOccurredAt) {
        d.assert(canOverrideTimestamp, 'Custom timestamps are only allowed for simulation/internal requests.', BadRequestError);
    }
    const effectiveOccurredAt = requestedOccurredAt || e.record.get('occurred_at') || new Date().toISOString();
    e.record.set('occurred_at', effectiveOccurredAt);

    e.next();
}, "proposal_votes");

onRecordAfterCreateSuccess((e: any) => {
    const d = require($filepath.join(__hooks, "utils", "runtime.js")).resolve();
    d.refreshQuestion(d.extractId(e.record.get('question')));
}, "question_votes");

onRecordAfterUpdateSuccess((e: any) => {
    const d = require($filepath.join(__hooks, "utils", "runtime.js")).resolve();
    d.refreshQuestion(d.extractId(e.record.get('question')));
}, "question_votes");

onRecordAfterDeleteSuccess((e: any) => {
    const d = require($filepath.join(__hooks, "utils", "runtime.js")).resolve();
    d.refreshQuestion(d.extractId(e.record.get('question')));
}, "question_votes");

onRecordAfterCreateSuccess((e: any) => {
    const d = require($filepath.join(__hooks, "utils", "runtime.js")).resolve();
    var recalcEngine = require($filepath.join(__hooks, 'services', 'score-recalc-engine.js'));
    recalcEngine.recalcForQuestion(d.extractId(e.record.get('question')));
}, "proposal_votes");

onRecordAfterUpdateSuccess((e: any) => {
    const d = require($filepath.join(__hooks, "utils", "runtime.js")).resolve();
    var recalcEngine = require($filepath.join(__hooks, 'services', 'score-recalc-engine.js'));
    recalcEngine.recalcForQuestion(d.extractId(e.record.get('question')));
}, "proposal_votes");

onRecordAfterDeleteSuccess((e: any) => {
    const d = require($filepath.join(__hooks, "utils", "runtime.js")).resolve();
    var recalcEngine = require($filepath.join(__hooks, 'services', 'score-recalc-engine.js'));
    recalcEngine.recalcForQuestion(d.extractId(e.record.get('question')));
}, "proposal_votes");
