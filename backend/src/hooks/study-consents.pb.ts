// @ts-nocheck
onRecordAfterCreateSuccess((e: core.RecordRequestEvent) => {
    var userId = e.record.get("user");
    if (!userId) {
        e.next();
        return;
    }

    try {
        var userRecord = $app.findRecordById("_pb_users_auth_", userId);
        userRecord.set("has_consented", true);
        $app.save(userRecord);
        $app.logger().info(`[study-consents] Automatically set has_consented=true for user ${userId}`);
    } catch (err) {
        $app.logger().error("[study-consents] Failed to set has_consented flag", err);
    }
    e.next();
}, "study_consents");
