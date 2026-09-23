/// <reference path="./pocketbase-globals.d.ts" />

// Proposal state update: covers cases where a proposal transitions to "Proposed" via update
onRecordAfterUpdateSuccess(function(e) {
    var prevState = e.record.original().getString("state");
    var nextState = e.record.getString("state");
    if (prevState !== "Proposed" && nextState === "Proposed") {
        var handleProposalPublished = require($filepath.join(__hooks, "services", "push-notifications-engine.js")).handleProposalPublished;
        handleProposalPublished(e.record);
    }
}, "proposals");

// Phase changes (field is "current_phase_name", not "phase")
onRecordAfterUpdateSuccess(function(e) {
    var prevPhase = e.record.original().getString("current_phase_name");
    var nextPhase = e.record.getString("current_phase_name");
    
    console.log("[PushEngine] Phase change hook fired for question:", e.record.id, "| prev:", prevPhase, "| next:", nextPhase);
    
    if (prevPhase === nextPhase) {
        console.log("[PushEngine] Phase unchanged, skipping notification.");
        return;
    }
    
    var notifiablePhases = ["Closing", "Voting"];
    if (notifiablePhases.indexOf(nextPhase) === -1) {
        console.log("[PushEngine] Phase", nextPhase, "is not notifiable, skipping.");
        return;
    }

    console.log("[PushEngine] Dispatching phase_change notification for phase:", nextPhase);
    var handlePhaseChange = require($filepath.join(__hooks, "services", "push-notifications-engine.js")).handlePhaseChange;
    handlePhaseChange(e.record);
}, "questions");


routerAdd('POST', '/api/push_subscribe_custom', function(e) {
    var auth = e.auth;
    if (!auth) return e.json(401, { message: 'Unauthorized' });

    var body = e.requestInfo().body || {};
    var endpoint = body.endpoint;
    if (!endpoint) return e.json(400, { message: 'Missing endpoint' });

    var d = require($filepath.join(__hooks, "utils", "runtime.js")).resolve();
    
    var existing = null;
    try {
        var existingArr = $app.findRecordsByFilter("push_subscriptions", "endpoint = {:endpoint}", "", 10, 0, { endpoint: endpoint });
        if (existingArr && existingArr.length > 0) {
            existing = existingArr[0];
        }
    } catch(err) {}

    if (existing) {
        // Update existing record to current user
        existing.set("user", auth.id);
        existing.set("p256dh", body.p256dh || '');
        existing.set("auth", body.auth || '');
        existing.set("user_agent", body.user_agent || '');
        $app.save(existing);
    } else {
        // Create new record
        var collection = $app.findCollectionByNameOrId("push_subscriptions");
        var record = new Record(collection);
        record.set("user", auth.id);
        record.set("endpoint", endpoint);
        record.set("p256dh", body.p256dh || '');
        record.set("auth", body.auth || '');
        record.set("user_agent", body.user_agent || '');
        $app.save(record);
    }

    return e.json(200, { success: true });
});
