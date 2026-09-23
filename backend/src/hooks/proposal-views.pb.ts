/// <reference path="./pocketbase-globals.d.ts" />

/**
 * Hook to mark a proposal as seen/viewed by the current user.
 * POST /api/remix/proposals/:id/view
 */
routerAdd(
	'POST',
	'/api/remix/proposals/{id}/view',
	(c) => {
		console.log("[hook:view] Headers:", c.request.header);
		let userId = null;
		
		try {
			const info = c.requestInfo();
			if (info && info.body) {
				userId = info.body.userId;
			}
		} catch (err) {
			console.log("[hook:view] requestInfo error", err);
		}
		
		if (!userId) {
			const user = c.auth;
			userId = user ? user.id : null;
		}

		if (!userId) {
			console.log("[hook:view] c.auth is NULL! Authorization header present?", !!c.request.header.get("Authorization"));
			throw new BadRequestError('Unauthorized');
		}

		console.log("[hook:view] Route hit, userId:", userId);

		const proposalId = c.request.pathValue("id");
		console.log("[hook:view] Path param 'id':", proposalId);

		const proposal = $app.findRecordById("proposals", proposalId);
		if (!proposal) {
			console.log("[hook:view] Proposal NOT FOUND:", proposalId);
			throw new NotFoundError(`Proposal not found: '${proposalId}'`);
		}
		console.log("[hook:view] Found proposal:", proposal.id);

	const questionId = proposal.get("question");

	// Find existing view record
	let viewRecord: core.Record | null = null;
	try {
		viewRecord = $app.findFirstRecordByFilter(
			"user_proposal_views",
			`user = '${userId}' && proposal = '${proposalId}'`
		);
	} catch (e) {
		// Not found
	}

	const now = new Date().toISOString();

	if (viewRecord) {
		// Update existing
		viewRecord.set("last_viewed", now);
		const currentCount = viewRecord.getInt("view_count") || 0;
		viewRecord.set("view_count", currentCount + 1);
		$app.save(viewRecord);
	} else {
		// Create new
		const collection = $app.findCollectionByNameOrId("user_proposal_views");
		const newRecord = new Record(collection);
		newRecord.set("user", userId);
		newRecord.set("proposal", proposalId);
		newRecord.set("question", questionId);
		newRecord.set("first_viewed", now);
		newRecord.set("last_viewed", now);
		newRecord.set("view_count", 1);
		
		$app.save(newRecord);

		// Increment unique_viewer_count on the proposal (only on first view)
		const currentViewers = proposal.getInt("unique_viewer_count") || 0;
		proposal.set("unique_viewer_count", currentViewers + 1);
		$app.save(proposal);
	}

	return c.json(200, { ok: true });
});
