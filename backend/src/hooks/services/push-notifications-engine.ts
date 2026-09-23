/**
 * push-notifications-engine.ts
 * Logic for sending push notifications using the frontend API.
 */

export function handleProposalPublished(record: any) {
    console.log("[PushEngine] handleProposalPublished called for proposal:", record.id);
    var d = require($filepath.join(__hooks, "utils", "runtime.js")).resolve();
    var parentId = d.extractId(record.get("branch_parent"));
    console.log("[PushEngine] Extracted branch_parent ID:", parentId);
    if (!parentId) {
        console.log("[PushEngine] No branch_parent found, exiting handleProposalPublished.");
        return;
    }

    var parent = d.tryCatch(function() { return $app.findRecordById("proposals", parentId); });
    console.log("[PushEngine] Parent proposal object exists:", !!parent);
    if (!parent) {
        console.log("[PushEngine] Parent proposal object not found.");
        return;
    }

    var authorId = d.extractId(parent.get("author"));
    var questionId = d.extractId(parent.get("question"));
    var newProposalAuthor = d.extractId(record.get("author"));
    console.log("[PushEngine DEBUG] Parent authorId:", authorId, "| QuestionId:", questionId, "| New Proposal Author:", newProposalAuthor);

    var pushTranslations = require($filepath.join(__hooks, "services", "push-translations.js")).pushTranslations;
    
    var parentTitle = parent.getString("title") || "";
    var remixTitle = record.getString("title") || "";

    var batch: any[] = [];

    // Notify author
    if (authorId && authorId !== newProposalAuthor) {
        console.log("[PushEngine DEBUG] Triggering proposal_remixed push for parent author:", authorId);
        var user = d.tryCatch(function() { return $app.findRecordById("users", authorId); });
        var lang = user ? (user.getString("language") || "en") : "en";
        var texts = pushTranslations["proposal_remixed"][lang] || pushTranslations["proposal_remixed"]["en"];
        
        var title = texts.title;
        var body = texts.body.replace("{remixTitle}", remixTitle);

        sendPushNotification(
            "proposal_remixed",
            authorId,
            parentId + "_" + record.id,
            {
                title: title,
                body: body,
                data: { url: "/questions/" + questionId + "/proposals/" + record.id }
            },
            batch
        );
    } else {
        console.log("[PushEngine DEBUG] Author is same as remixer or authorId empty, skipping author notification.");
    }

    // Notify active voters of parent (optimized with batch queries)
    var votes = d.tryCatch(function() {
        return $app.findRecordsByFilter("proposal_votes", "proposal = {:pid} && vote > 0", "", 10000, 0, { pid: parentId });
    }) || [];
    console.log("[PushEngine DEBUG] Found parent active votes count:", votes.length);

    if (votes.length > 0) {
        // Collect candidate voter IDs (excluding author & new remixer)
        var candidateVoterIds: string[] = [];
        var candidateMap: { [key: string]: boolean } = {};
        for (var i = 0; i < votes.length; i++) {
            var vId = d.extractId(votes[i].get("user"));
            if (vId && vId !== newProposalAuthor && vId !== authorId && !candidateMap[vId]) {
                candidateMap[vId] = true;
                candidateVoterIds.push(vId);
            }
        }

        if (candidateVoterIds.length > 0) {
            console.log(`[PushEngine] Target users identified: ${candidateVoterIds.length}`);

            // Batch query votes on the new remix proposal (to suppress voters who already support the remix)
            var remixVotes = d.tryCatch(function() {
                return $app.findRecordsByFilter("proposal_votes", "proposal = {:pid} && vote > 0", "", 10000, 0, { pid: record.id });
            }) || [];
            var remixVoters: { [key: string]: boolean } = {};
            for (var r = 0; r < remixVotes.length; r++) {
                var rUid = d.extractId(remixVotes[r].get("user"));
                if (rUid) remixVoters[rUid] = true;
            }



            // Batch query recent notification logs for 6h cooldown
            var referenceId = parentId + "_" + record.id;
            var sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
            var recentLogs = d.tryCatch(function() {
                return $app.findRecordsByFilter("push_notification_log", "event_type = 'vote_migration' && reference_id = {:ref} && created >= {:date}", "", 10000, 0, {
                    ref: referenceId,
                    date: sixHoursAgo.toISOString().replace('T', ' ')
                });
            }) || [];
            var cooldownMap: { [key: string]: boolean } = {};
            for (var l = 0; l < recentLogs.length; l++) {
                var lUid = d.extractId(recentLogs[l].get("user"));
                if (lUid) cooldownMap[lUid] = true;
            }

            // Iterate candidate voters who pass all batch filters
            for (var k = 0; k < candidateVoterIds.length; k++) {
                var voterId = candidateVoterIds[k];
                if (remixVoters[voterId]) {
                    console.log(`[PushEngine DEBUG] Voter ${voterId} already supports remix, skipping.`);
                    continue;
                }

                if (cooldownMap[voterId]) {
                    console.log(`[PushEngine DEBUG] Voter ${voterId} is on notification cooldown, skipping.`);
                    continue;
                }

                var userRecord = d.tryCatch(function() { return $app.findRecordById("users", voterId); });
                var userLang = userRecord ? (userRecord.getString("language") || "en") : "en";
                var migrationTexts = pushTranslations["vote_migration"][userLang] || pushTranslations["vote_migration"]["en"];

                var migrationTitle = migrationTexts.title;
                var migrationBody = migrationTexts.body.replace("{parentTitle}", parentTitle);

                sendPushNotification(
                    "vote_migration",
                    voterId,
                    referenceId,
                    {
                        title: migrationTitle,
                        body: migrationBody,
                        data: { url: "/questions/" + questionId + "/proposals/" + record.id + "?action=compare" }
                    },
                    batch
                );
            }
        } else {
            console.log("[PushEngine DEBUG] No eligible users to notify.");
        }
    }

    if (batch.length > 0) {
        dispatchPushBatch(batch);
    }
}

export function sendPushNotification(eventType: string, userId: string, referenceId: string, payload: any, batchArr?: any[]) {
    console.log(`[PushEngine DEBUG] sendPushNotification called - eventType: ${eventType}, userId: ${userId}, referenceId: ${referenceId}`);
    if (!payload || (!payload.title && !payload.body)) {
        console.log(`[PushEngine DEBUG] Invalid payload (missing title/body) for user ${userId}, event ${eventType}. Exiting.`);
        return;
    }
    try {
        const d = require($filepath.join(__hooks, "utils", "runtime.js")).resolve();
        
        // Cooldown: same event type + same reference within 6 hours
        const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
        let recentLogs = null;
        try {
            const filterStr = "user = {:uid} && event_type = {:etype} && reference_id = {:ref} && created >= {:date}";
            recentLogs = $app.findRecordsByFilter("push_notification_log", filterStr, "", 10000, 0, {
                uid: userId,
                etype: eventType,
                ref: referenceId,
                date: sixHoursAgo.toISOString().replace('T', ' ')
            });
        } catch(e) {
            // no records found
        }
        
        if (recentLogs && recentLogs.length > 0) {
            console.log(`[PushEngine DEBUG] Cooldown active for user ${userId}, event ${eventType}, ref ${referenceId}. Exiting.`);
            return; // Cooldown active
        }

        console.log(`[PushEngine DEBUG] Saving push_notification_log record for user: ${userId}`);
        const logCollection = $app.findCollectionByNameOrId("push_notification_log");
        const newLog = new Record(logCollection);
        newLog.set("user", userId);
        newLog.set("event_type", eventType);
        newLog.set("reference_id", referenceId);
        newLog.set("status", "pending");
        newLog.set("payload_json", JSON.stringify(payload));
        $app.save(newLog);
        console.log(`[PushEngine DEBUG] push_notification_log saved successfully. ID: ${newLog.id}`);

        // Append log ID to payload URL for push action tracking
        if (payload.data && payload.data.url) {
            const separator = payload.data.url.indexOf('?') !== -1 ? '&' : '?';
            payload.data.url += separator + "notif=" + newLog.id;
        }
        if (payload.data) {
            payload.data.logId = newLog.id;
        }

        let subs = null;
        try {
            subs = $app.findRecordsByFilter("push_subscriptions", "user = {:uid}", "", 10000, 0, { uid: userId });
        } catch(e) {
            console.log(`[PushEngine DEBUG] Exception or no records finding subscriptions for user ${userId}:`, e);
        }
        console.log(`[PushEngine DEBUG] Subscriptions found for user ${userId}: ${subs ? subs.length : 0}, endpoints: ${subs ? subs.map((s: any) => s.getString("endpoint").substring(0, 50)).join(', ') : 'none'}`);
        if (!subs || subs.length === 0) {
            console.log(`[PushEngine DEBUG] No push subscriptions registered for user ${userId}. Cannot send push HTTP request.`);
            return;
        }
        
        const subscriptionsData = [];
        for (let i = 0; i < subs.length; i++) {
            subscriptionsData.push({
                id: subs[i].id,
                endpoint: subs[i].get("endpoint"),
                p256dh: subs[i].get("p256dh"),
                auth: subs[i].get("auth")
            });
        }
        
        if (batchArr) {
            batchArr.push({ subscriptions: subscriptionsData, payload: payload });
            return;
        }
        
        const frontendUrl = $os.getenv("FRONTEND_URL") || "http://sveltekit-dev:5173";
        const pushSecret = $os.getenv("PUSH_SECRET") || "";
        
        console.log(`[PushEngine DEBUG] Dispatching HTTP POST to frontendUrl: ${frontendUrl}/api/push-send for ${subscriptionsData.length} subscriptions`);
        
        const res = $http.send({
            url: frontendUrl + "/api/push-send",
            method: "POST",
            timeout: 30,
            headers: {
                "Content-Type": "application/json",
                "Origin": frontendUrl
            },
            body: JSON.stringify({
                secret: pushSecret,
                subscriptions: subscriptionsData,
                payload: payload
            })
        });
        
        console.log(`[PushEngine] HTTP POST Response status: ${res.statusCode}`);
        console.log(`[PushEngine DEBUG] Response body raw: ${res.raw}`);
        if (res.statusCode >= 400) {
            console.log(`[PushEngine] Failed to send push to SvelteKit. Status: ${res.statusCode}, Body: ${res.raw || JSON.stringify(res.json)}`);
            return;
        }

        if (res.json && res.json.failures) {
            deleteStaleSubscriptions(res.json.failures);
        }

    } catch (e) {
        console.log(`[PushEngine DEBUG] Unhandled exception sending event '${eventType}' to user '${userId}': ` + e);
    }
}

export function dispatchPushBatch(batchArr: any[]) {
    console.log(`[PushEngine DEBUG] Dispatching batch HTTP POST with ${batchArr.length} messages`);
    if (batchArr.length === 0) return;

    try {
        const frontendUrl = $os.getenv("FRONTEND_URL") || "http://sveltekit-dev:5173";
        const pushSecret = $os.getenv("PUSH_SECRET") || "";

        const res = $http.send({
            url: frontendUrl + "/api/push-send",
            method: "POST",
            timeout: 30,
            headers: {
                "Content-Type": "application/json",
                "Origin": frontendUrl
            },
            body: JSON.stringify({
                secret: pushSecret,
                messages: batchArr
            })
        });

        console.log(`[PushEngine] Batch HTTP POST Response status: ${res.statusCode}`);
        console.log(`[PushEngine DEBUG] Response body raw: ${res.raw}`);
        if (res.statusCode >= 400) {
            console.log(`[PushEngine] Failed to send batch push to SvelteKit. Status: ${res.statusCode}, Body: ${res.raw || JSON.stringify(res.json)}`);
            return;
        }

        if (res.json && res.json.failures) {
            console.log(`[PushEngine] Failures reported by SvelteKit batch endpoint:`, res.json.failures.length);
            deleteStaleSubscriptions(res.json.failures);
        }
    } catch (e) {
        console.log(`[PushEngine DEBUG] Unhandled exception sending push batch: ` + e);
    }
}

function deleteStaleSubscriptions(failures: any[]) {
    for (let i = 0; i < failures.length; i++) {
        if (failures[i].statusCode === 410 || failures[i].statusCode === 404) {
            if (failures[i].id) {
                try {
                    const subRecord = $app.findRecordById("push_subscriptions", failures[i].id);
                    if (subRecord) {
                        $app.delete(subRecord);
                        console.log(`[PushEngine DEBUG] Deleted stale push subscription ${failures[i].id}`);
                    }
                } catch(e) {}
            }
        }
    }
}

export function handlePhaseChange(record: any) {
    console.log("[PushEngine DEBUG] handlePhaseChange called for question:", record.id);
    var d = require($filepath.join(__hooks, "utils", "runtime.js")).resolve();
    var nextPhase = record.getString("current_phase_name");
    var questionId = record.id;
    var questionTitle = record.getString("title") || "";
    var groupId = d.extractId(record.get("group"));
    if (!groupId) return;

    var memberIds = getNotificationRecipients(d, record, groupId, questionId);
    if (memberIds.length === 0) return;

    var userLangMap: { [key: string]: string } = {};
    for (var i = 0; i < memberIds.length; i++) {
        var mId = memberIds[i];
        var userRec = d.tryCatch(function() {
            return $app.findRecordById("users", mId);
        });
        if (userRec) {
            userLangMap[mId] = userRec.getString("language") || "en";
        }
    }



    // BATCH 3: all recent cooldown logs
    var refId = questionId + "_" + nextPhase;
    var sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    var recentLogs = d.tryCatch(function() {
        return $app.findRecordsByFilter("push_notification_log",
            "event_type = 'phase_change' && reference_id = {:ref} && created >= {:date}", "", 10000, 0,
            { ref: refId, date: sixHoursAgo.toISOString().replace("T", " ") });
    }) || [];
    var cooldownMap: { [key: string]: boolean } = {};
    for (var l = 0; l < recentLogs.length; l++) {
        var lUid = d.extractId(recentLogs[l].get("user"));
        if (lUid) cooldownMap[lUid] = true;
    }

    var pushTranslations = require($filepath.join(__hooks, "services", "push-translations.js")).pushTranslations;
    var eventKey = "phase_change_" + nextPhase;
    var batch: any[] = [];

    // Guard: skip if no translation exists for this phase (e.g. FinalResult, etc.)
    var translationEntry = pushTranslations[eventKey];
    if (!translationEntry) {
        console.log(`[PushEngine] No translation defined for eventKey '${eventKey}', skipping phase change notifications.`);
        return;
    }

    for (var k = 0; k < memberIds.length; k++) {
        var memberId = memberIds[k];

        if (cooldownMap[memberId]) {
            console.log(`[PushEngine] Phase change: Member ${memberId} is on notification cooldown, skipping.`);
            continue; // cooldown
        }
        
        var lang = userLangMap[memberId] || "en";
        var texts = translationEntry[lang] || translationEntry["en"];
        var title = texts.title;
        var body = texts.body.replace("{questionTitle}", questionTitle);

        sendPushNotification("phase_change", memberId, refId,
            { title: title, body: body, data: { url: "/questions/" + questionId + "/proposals/question" } },
            batch
        );
    }

    if (batch.length > 0) {
        dispatchPushBatch(batch);
    }
}

export function handleDeadlineReminder(record: any, eventType: string, phaseName: string) {
    console.log("[PushEngine DEBUG] handleDeadlineReminder called for question:", record.id, "eventType:", eventType, "phaseName:", phaseName);
    var d = require($filepath.join(__hooks, "utils", "runtime.js")).resolve();
    var questionId = record.id;
    var questionTitle = record.getString("title") || "";
    var groupId = d.extractId(record.get("group"));
    if (!groupId) return;

    var memberIds = getNotificationRecipients(d, record, groupId, questionId);
    if (memberIds.length === 0) return;

    var userLangMap: { [key: string]: string } = {};
    for (var i = 0; i < memberIds.length; i++) {
        var mId = memberIds[i];
        var userRec = d.tryCatch(function() {
            return $app.findRecordById("users", mId);
        });
        if (userRec) {
            userLangMap[mId] = userRec.getString("language") || "en";
        }
    }

    var pushTranslations = require($filepath.join(__hooks, "services", "push-translations.js")).pushTranslations;
    var eventKey = eventType + "_" + phaseName;
    var batch: any[] = [];

    // Guard: skip if no translation exists for this phase
    var translationEntry = pushTranslations[eventKey];
    if (!translationEntry) {
        console.log(`[PushEngine] No translation defined for eventKey '${eventKey}', skipping deadline reminder notifications.`);
        return;
    }
    
    var refId = questionId + "_" + phaseName + "_" + eventType;

    for (var k = 0; k < memberIds.length; k++) {
        var memberId = memberIds[k];
        
        var lang = userLangMap[memberId] || "en";
        var texts = translationEntry[lang] || translationEntry["en"];
        var title = texts.title;
        var body = texts.body.replace("{questionTitle}", questionTitle);

        sendPushNotification(eventType, memberId, refId,
            { title: title, body: body, data: { url: "/questions/" + questionId + "/proposals/question" } },
            batch
        );
    }

    if (batch.length > 0) {
        dispatchPushBatch(batch);
    }
}

export function getNotificationRecipients(d: any, record: any, groupId: string, questionId: string): string[] {
    var members = d.tryCatch(function() {
        return $app.findRecordsByFilter("group_members", "group = {:g}", "", 10000, 0, { g: groupId });
    }) || [];
    
    // Pattern: Notify group members AND all participants (authors, proposers, voters)
    var memberIds: string[] = [];
    var candidateMap: { [key: string]: boolean } = {};
    
    // 1. Add group members
    for (var m = 0; m < members.length; m++) {
        var mid = d.extractId(members[m].get("user"));
        if (mid && !candidateMap[mid]) {
            candidateMap[mid] = true;
            memberIds.push(mid);
        }
    }
    
    // 2. Add question author
    var qAuthor = d.extractId(record.get("author"));
    if (qAuthor && !candidateMap[qAuthor]) {
        candidateMap[qAuthor] = true;
        memberIds.push(qAuthor);
    }
    
    // 3. Add all proposal authors
    var proposals = d.tryCatch(function() {
        return $app.findRecordsByFilter("proposals", "question = {:q}", "", 10000, 0, { q: questionId });
    }) || [];
    for (var p = 0; p < proposals.length; p++) {
        var pAuthor = d.extractId(proposals[p].get("author"));
        if (pAuthor && !candidateMap[pAuthor]) {
            candidateMap[pAuthor] = true;
            memberIds.push(pAuthor);
        }
    }
    
    // 4. Add all proposal voters
    var votes = d.tryCatch(function() {
        return $app.findRecordsByFilter("proposal_votes", "question = {:q}", "", 10000, 0, { q: questionId });
    }) || [];
    for (var v = 0; v < votes.length; v++) {
        var vUser = d.extractId(votes[v].get("user"));
        if (vUser && !candidateMap[vUser]) {
            candidateMap[vUser] = true;
            memberIds.push(vUser);
        }
    }
    
    return memberIds;
}
