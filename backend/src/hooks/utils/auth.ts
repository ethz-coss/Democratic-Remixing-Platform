var errors = require($filepath.join(__hooks, "utils", "errors.js"));
var err = errors.err;
var tryCatch = errors.tryCatch;

function getAuth(e) {
    return e.auth || tryCatch(function() {
        var reqInfo = e.requestInfo ? e.requestInfo() : null;
        return reqInfo && reqInfo.auth ? reqInfo.auth : null;
    }) || null;
}

function reqAuth(e) {
    return getAuth(e) || err('Authentication required.', UnauthorizedError);
}

function isInternal(e) {
    return !getAuth(e) && tryCatch(function() {
        return !e.requestInfo();
    });
}

function isAdminAuth(e) {
    // PocketBase v0.22+ native superusers
    if (e.admin) return true;
    if (e.requestInfo && tryCatch(function() { return e.requestInfo().admin; })) return true;
    if (e.hasSuperuserAuth && tryCatch(function() { return e.hasSuperuserAuth(); })) return true;

    var auth = getAuth(e);
    if (!auth) return false;

    var collectionName = String(tryCatch(function() {
        return auth.collectionName || auth.get('collectionName');
    }, auth.collectionName || '') || '').trim().toLowerCase();
    
    if (collectionName === 'users') {
        var role = String(tryCatch(function() { return auth.get('role'); }, '') || '').trim().toLowerCase();
        return role === 'admin';
    }
    
    if (!collectionName) return false;
    return collectionName !== 'users';
}

function isSimulationAuth(e) {
    var auth = getAuth(e);
    if (!auth || auth.collectionName !== 'users') return false;

    var simulation = tryCatch(function() {
        return auth.get('simulation');
    }, auth.simulation);

    if (simulation === true || simulation === 'true' || simulation === 1 || simulation === '1') {
        return true;
    }

    if (!auth.id) return false;
    simulation = tryCatch(function() {
        return $app.findRecordById('users', auth.id).get('simulation');
    }, false);

    return simulation === true || simulation === 'true' || simulation === 1 || simulation === '1';
}

function isSimulationUserId(userId) {
    var id = String(userId || '').trim();
    if (!id) return false;

    var simulation = tryCatch(function() {
        return $app.findRecordById('users', id).get('simulation');
    }, false);

    return simulation === true || simulation === 'true' || simulation === 1 || simulation === '1';
}

module.exports = {
    getAuth: getAuth,
    reqAuth: reqAuth,
    isInternal: isInternal,
    isAdminAuth: isAdminAuth,
    isSimulationAuth: isSimulationAuth,
    isSimulationUserId: isSimulationUserId
};
