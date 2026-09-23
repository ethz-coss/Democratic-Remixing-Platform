
function err(msg, Err) {
    var ErrorType = Err || BadRequestError;
    throw new ErrorType(msg);
}

function assert(cond, msg, Err) {
    var ErrorType = Err || BadRequestError;
    if (!cond) throw new ErrorType(msg);
}

function tryCatch(fn, fallback) {
    var fb = (fallback === undefined) ? null : fallback;
    try {
        return fn();
    } catch (e) {
        return fb;
    }
}

function logHookError(scope, error, context) {
    var name = scope || 'hook';
    var errObj = error || new Error('Unknown hook error');
    var message = String((errObj && errObj.message) || errObj);
    var stack = String((errObj && errObj.stack) || '');
    var ctx = context || {};
    var ctxJson = tryCatch(function() {
        return JSON.stringify(ctx);
    }, '{}');

    // Always print to container logs for fast debugging.
    console.log('[hook-error] scope=' + name + ' message=' + message + ' context=' + ctxJson);
    if (stack) console.log('[hook-error] stack=' + stack);

    // Also attempt to persist in PocketBase logs collection.
    try {
        $app.logger().error(
            '[hook-error] ' + name + ': ' + message,
            'scope', name,
            'errorMessage', message,
            'stack', stack,
            'context', ctxJson
        );
    } catch (logErr) {
        console.log('[hook-error] loggerFailure=' + String((logErr && logErr.message) || logErr));
    }
}

function logHookInfo(scope, context) {
    var name = scope || 'hook';
    var ctx = context || {};
    var ctxJson = tryCatch(function() {
        return JSON.stringify(ctx);
    }, '{}');

    console.log('[hook-info] scope=' + name + ' context=' + ctxJson);

    try {
        $app.logger().info(
            '[hook-info] ' + name,
            'scope', name,
            'context', ctxJson
        );
    } catch (logErr) {
        console.log('[hook-info] loggerFailure=' + String((logErr && logErr.message) || logErr));
    }
}

module.exports = {
    err: err,
    assert: assert,
    tryCatch: tryCatch,
    logHookError: logHookError,
    logHookInfo: logHookInfo
};
