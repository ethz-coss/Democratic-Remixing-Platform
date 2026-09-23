// backend/src/hooks/hides.pb.ts

onRecordAfterCreateSuccess(function(e) {
    var d = require($filepath.join(__hooks, "utils", "runtime.js")).resolve();
    
    // WARNING: Auto-unsubscribe logic
    // When a user hides a proposal, this silently DELETES their proposal_votes record!
    // This effectively retracts their vote without any notification to the user.
    var userId = e.record.get("user");
    var proposalId = e.record.get("proposal");
    
    if (userId && proposalId) {
        try {
            var existingVotes = $app.findRecordsByFilter("proposal_votes", "user = {:uid} && proposal = {:pid} && vote = 1", "", 10, 0, {
                uid: userId,
                pid: proposalId
            });
            
            existingVotes.forEach(function(voteRecord) {
                $app.delete(voteRecord);
                console.log("[Hides] Auto-unsubscribed user " + userId + " from hidden proposal " + proposalId);
            });
        } catch(err) {
            console.log("[Hides] Error during auto-unsubscribe: " + err);
        }
    }
    e.next();
}, "proposal_hides");
