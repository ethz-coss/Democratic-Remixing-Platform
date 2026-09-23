/// <reference path="./pocketbase-globals.d.ts" />

onRecordCreateRequest((e) => {
    try {
        var d = require($filepath.join(__hooks, 'utils', 'runtime.js')).resolve();
        var parents = e.record.getStringSlice('parent_proposals') || [];

        var questionId = d.extractId(e.record.get('question'));
        var parentRecords = [];
        parents.forEach(function(parentId) {
            try {
                var parentRecord = $app.findRecordById('proposals', parentId);
                if (parentRecord && d.extractId(parentRecord.get('question')) === questionId) {
                    parentRecords.push(parentRecord);
                }
            } catch (_) {
                // Ignore missing records
            }
        });
        d.assert(parentRecords.length === parents.length, 'All parent proposals must exist and belong to the same question.');

        var branchParentId = parentRecords.length > 0 ? parentRecords[0].id : '';
        var rootProposalId = '';
        var maxParentDepth = 0;
        parentRecords.forEach(function(parentRecord) {
            var parentRoot = d.extractId(parentRecord.get('root_proposal')) || parentRecord.id;
            if (!rootProposalId) {
                rootProposalId = parentRoot;
            }
            var depth = Math.max(0, Math.round(Number(parentRecord.get('branch_depth') || 0)));
            if (depth > maxParentDepth) {
                maxParentDepth = depth;
            }
        });

        e.record.set('branch_parent', branchParentId || '');
        e.record.set('branch_depth', parentRecords.length > 0 ? maxParentDepth + 1 : 0);

        // Use label-rules engine
        var labelRules = require($filepath.join(__hooks, 'services', 'label-rules.js'));
        
        var newLabelsStr = e.record.getStringSlice('labels') || [];
        var labelStr = newLabelsStr.length > 0 ? String(newLabelsStr[0]).trim() : '';
        
        var parentLabelsArray = [];
        var parentPrimaryLabels = [];
        
        for (var i = 0; i < parentRecords.length; i++) {
            var pLabels = parentRecords[i].getStringSlice('labels') || [];
            var pLabelStrings = [];
            for (var j = 0; j < pLabels.length; j++) {
                pLabelStrings.push(String(pLabels[j]).trim());
            }
            parentLabelsArray.push(pLabelStrings);
            parentPrimaryLabels.push(String(parentRecords[i].get('primary_label') || '').trim());
        }

        var ruleInput = {
            parentCount: parentRecords.length,
            labelStr: labelStr,
            title: String(e.record.get('title') || ''),
            parentLabels: parentLabelsArray,
            parentPrimaryLabels: parentPrimaryLabels
        };

        var ruleOutput = labelRules.enforceLabelRules(ruleInput);
        
        var newLabelId = '';
        if (ruleOutput.shouldCreateLabel && ruleOutput.newLabelShortName) {
            var existing = null;
            try {
                existing = $app.findFirstRecordByFilter('labels', `question='${questionId}' && short_name='${ruleOutput.newLabelShortName.replace(/'/g, "''")}'`);
            } catch (_) {}
            if (existing) {
                newLabelId = existing.id;
            } else {
                var collection = $app.findCollectionByNameOrId('labels');
                var newLabel = new Record(collection);
                newLabel.set('question', questionId);
                newLabel.set('short_name', ruleOutput.newLabelShortName);
                newLabel.set('color', '#60a5fa');
                $app.save(newLabel);
                newLabelId = newLabel.id;
            }
        }
        
        var finalLabels = ruleOutput.resolvedLabels(newLabelId);
        e.record.set('labels', finalLabels);
        
        var finalPrimary = ruleOutput.resolvedPrimaryLabel(newLabelId);
        if (finalPrimary) {
            e.record.set('primary_label', finalPrimary);
        } else {
            e.record.set('primary_label', '');
        }

        if (rootProposalId) {
            e.record.set('root_proposal', rootProposalId);
        }
        
        e.next();
    } catch (err) {
        console.error("proposals onRecordCreateRequest failed:", err);
        throw err;
    }
}, 'proposals');

onRecordAfterCreateSuccess((e) => {
    var d = require($filepath.join(__hooks, 'utils', 'runtime.js')).resolve();
    var userId = d.extractId(e.record.get('author'));
    var questionId = d.extractId(e.record.get('question'));
    var recordId = e.record.id;

    var userExists = false;
    try {
        userExists = !!$app.findRecordById('users', userId);
    } catch (_) {}

    if (userExists) {


        try {
            var actionLogCollection = $app.findCollectionByNameOrId("action_logs");
            var record = new Record(actionLogCollection);
            record.set("question", questionId);
            record.set("user", userId);
            record.set("action_type", "subscribe");
            record.set("target_id", recordId);
            record.set("occurred_at", e.record.getString("occurred_at") || new Date().toISOString());
            $app.save(record);
        } catch (err) {
            console.error("Failed to automatically subscribe creator (action log)", err);
        }

        try {
            var votesCollection = $app.findCollectionByNameOrId("proposal_votes");
            var voteRecord = new Record(votesCollection);
            voteRecord.set("question", questionId);
            voteRecord.set("user", userId);
            voteRecord.set("proposal", recordId);
            voteRecord.set("vote", 1);
            voteRecord.set("occurred_at", e.record.getString("occurred_at") || new Date().toISOString());
            $app.save(voteRecord);
        } catch (err) {
            console.error("Failed to automatically subscribe creator (vote record)", err);
        }
    }

    // Push notification for proposal published
    try {
        var state = e.record.getString("state");
        if (state === "Proposed") {
            var handleProposalPublished = require($filepath.join(__hooks, "services", "push-notifications-engine.js")).handleProposalPublished;
            handleProposalPublished(e.record);
        }
    } catch(err) {
        console.error("Failed to trigger push notification for new proposal", err);
    }

}, 'proposals');
