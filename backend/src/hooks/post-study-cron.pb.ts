/// <reference path="./pocketbase-globals.d.ts" />

cronAdd("checkPostStudySurveys", "0 12 * * *", () => {
    try {
        console.log("[survey-cron] Running post-study survey check at", new Date().toISOString());
        const requireRuntime = require($filepath.join(__hooks, "utils", "runtime.js"));
        const runtime = requireRuntime.resolve();

        // Get all users
        const users = $app.findRecordsByFilter("users", "1=1");
        if (!users || users.length === 0) return;

        // Find users who have already submitted
        const surveys = $app.findRecordsByFilter("post_study_surveys", "1=1");
        const submittedUserIds = [];
        if (surveys) {
            for (let i = 0; i < surveys.length; i++) {
                submittedUserIds.push(surveys[i].get("user"));
            }
        }
        
        console.log("[survey-cron] Checked", users.length, "users,", submittedUserIds.length, "already submitted");

        for (let i = 0; i < users.length; i++) {
            const user = users[i];
            const userId = user.getId();

            if (submittedUserIds.includes(userId)) continue;

            const existingLogs = $app.findRecordsByFilter("push_notification_log", `user = '${userId}' && event_type = 'survey_unlocked'`);
            if (existingLogs && existingLogs.length > 0) continue;

            // Check if user has voted on all questions in their groups
            const groupMembers = runtime.tryCatch(() => $app.findRecordsByFilter("group_members", `user = '${userId}'`), []);
            if (!groupMembers || groupMembers.length === 0) continue;

            let allVoted = true;
            let hasQuestions = false;

            for (let j = 0; j < groupMembers.length; j++) {
                const groupId = groupMembers[j].get("group");
                const questions = runtime.tryCatch(() => $app.findRecordsByFilter("questions", `group = '${groupId}'`), []);
                
                if (questions && questions.length > 0) {
                    hasQuestions = true;
                    for (let k = 0; k < questions.length; k++) {
                        const questionId = questions[k].getId();
                        const votes = runtime.tryCatch(() => $app.findRecordsByFilter("question_votes", `user = '${userId}' && question = '${questionId}'`), []);
                        
                        if (!votes || votes.length === 0) {
                            allVoted = false;
                            break;
                        }
                    }
                }
                if (!allVoted) break;
            }
            
            console.log("[survey-cron] User", userId, "- hasQuestions:", hasQuestions, ", allVoted:", allVoted);

            // Only send notification if they have at least one question and have voted on all of them
            if (hasQuestions && allVoted) {
                const pushTranslations = require($filepath.join(__hooks, "services", "push-translations.js")).pushTranslations;
                const lang = user.get("language") || "en";
                const texts = pushTranslations["survey_unlocked"][lang] || pushTranslations["survey_unlocked"]["en"];

                // Send push notification
                const engine = require($filepath.join(__hooks, "services", "push-notifications-engine.js"));
                engine.sendPushNotification('survey_unlocked', userId, userId, {
                    title: texts.title,
                    body: texts.body,
                    data: { url: "/post-study-survey" }
                });
            }
        }
    } catch (e) {
        console.log("survey CRON failed: " + e);
    }
});

