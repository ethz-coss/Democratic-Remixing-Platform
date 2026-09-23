// src/hooks/users.pb.ts
//
// Protects the users.role field from self-escalation.
// Only superuser/internal requests can change the role.

// @ts-nocheck
onRecordUpdateRequest(function(e: core.RecordRequestEvent) {
    var rt = require($filepath.join(__hooks, 'utils', 'runtime.js'));
    var d = rt.resolve();

    var newRole = String(e.record.get('role') || '');
    var oldRole = String(e.record.original().get('role') || '');

    if (newRole !== oldRole) {
        // Only allow role changes from superuser auth or internal calls
        if (!d.isAdminAuth(e) && !d.isInternal(e)) {
            throw new ForbiddenError('Only administrators can change user roles.');
        }
    }

    e.next();
}, "users");
