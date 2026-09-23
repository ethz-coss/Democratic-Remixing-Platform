// @ts-nocheck
routerAdd("GET", "/api/invites/{token}", (e) => {
    var token = e.request.pathValue("token");
    if (!token) {
        throw new BadRequestError("Token is required.");
    }

    try {
        var group = $app.findFirstRecordByData("groups", "invite_token", token);
        return e.json(200, {
            id: group.id,
            name: group.get("name"),
            description: group.get("description")
        });
    } catch (err) {
        throw new BadRequestError("Invalid invite token.");
    }
});

routerAdd("POST", "/api/invites/{token}/join", (e) => {
    var token = e.request.pathValue("token");
    var authRecord = e.auth;

    if (!authRecord) {
        throw new UnauthorizedError("You must be logged in to join a group.");
    }

    try {
        var group = $app.findFirstRecordByData("groups", "invite_token", token);
    } catch (err) {
        throw new BadRequestError("Invalid invite token.");
    }

    // Check if already a member
    try {
        // We use findRecordsByFilter because findFirstRecordByData only takes pairs
        var existing = $app.findRecordsByFilter("group_members", `group="${group.id}" && user="${authRecord.id}"`, "", 1);
        if (existing && existing.length > 0) {
            return e.json(200, { message: "Already a member." });
        }
    } catch (err) {
        // No match found
    }

    // Create group_members record
    var collection = $app.findCollectionByNameOrId("group_members");
    var record = new Record(collection);
    record.set("group", group.id);
    record.set("user", authRecord.id);
    record.set("role", "Member");

    $app.save(record);

    return e.json(200, { message: "Successfully joined group." });
});
