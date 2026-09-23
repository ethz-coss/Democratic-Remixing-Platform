
onRecordCreateRequest(function(e) {
    var d = require($filepath.join(__hooks, "utils", "runtime.js")).resolve();

    try {  
        var reqData = d.getReqData(e);
        var requestedAuthorId = d.extractId(e.record.get('author')) || d.extractId(reqData.author);
        var requestedOccurredAt = reqData.occurred_at ? d.parseIsoTimestamp(reqData.occurred_at) : null;
        var canOverrideTimestamp = d.isInternal(e) || d.isAdminAuth(e) || d.isSimulationAuth(e) || d.isSimulationUserId(requestedAuthorId);
        if (requestedOccurredAt) {
            d.assert(canOverrideTimestamp, 'Custom timestamps are only allowed for simulation/internal requests.', BadRequestError);
        }
        var effectiveOccurredAt = requestedOccurredAt || e.record.get('occurred_at') || new Date().toISOString();
        e.record.set('occurred_at', effectiveOccurredAt);

        var author = d.extractId(e.record.get('author')) || d.extractId(reqData.author);
        if (author) {
            var requestedAuthor = d.tryCatch(function() {
                return $app.findRecordById('users', author);
            }, null);
            if (!requestedAuthor) {
                author = '';
            }
        }
        // Keep prototype flow permissive: accept provided author, then attempt user-auth, then fallback.
        if (!author) {
            author = d.tryCatch(function() {
                var auth = d.getAuth(e);
                if (!auth || auth.collectionName !== 'users') return '';
                return auth.id || '';
            }, '');
            if (author) {
                var authUser = d.tryCatch(function() {
                    return $app.findRecordById('users', author);
                }, null);
                if (!authUser) {
                    author = '';
                }
            }
        }
        if (!author) {
            var firstUsers = [];
            try {
                firstUsers = $app.findRecordsByFilter('users', 'id != ""', '', 1, 0);
            } catch (lookupError) {
                if (typeof d.logHookError === 'function') {
                    d.logHookError('questions.create.users_lookup', lookupError, {
                        recordId: e.record && e.record.id ? e.record.id : '',
                        title: String(e.record && e.record.get('title') || '')
                    });
                } else {
                    console.log('[hook-error] scope=questions.create.users_lookup message=' + String((lookupError && lookupError.message) || lookupError));
                }
            }
            var firstUser = firstUsers.length > 0 ? firstUsers[0] : null;
            author = firstUser ? firstUser.id : '';
        }
        d.assert(author, 'Author is required. Create at least one user record first.');
        e.record.set('author', author);

        var title = String(e.record.get('title') || '').trim();
        d.assert(title.length >= 5, 'Title must be at least 5 characters.');

        var discussionDeadline = e.record.get('discussion_deadline');
        if (!discussionDeadline) {
            var dd = new Date(effectiveOccurredAt);
            dd.setDate(dd.getDate() + 14);
            e.record.set('discussion_deadline', dd.toISOString().replace('T', ' '));
        }

        var closingDeadline = e.record.get('closing_window_deadline');
        if (!closingDeadline) {
            var cd = new Date(effectiveOccurredAt);
            cd.setDate(cd.getDate() + 16);
            e.record.set('closing_window_deadline', cd.toISOString().replace('T', ' '));
        }

        var voteDeadline = e.record.get('vote_deadline');
        if (!voteDeadline) {
            var vd = new Date(effectiveOccurredAt);
            vd.setDate(vd.getDate() + 18);
            e.record.set('vote_deadline', vd.toISOString().replace('T', ' '));
        }

        var effectiveStatus = d.normalizeQuestionPhase(
            e.record.get('current_phase_name') || d.PHASE_PROPOSED
        );
        d.applyQuestionPhaseFields(e.record, effectiveStatus);
        e.next();
        d.tryCatch(function() {
            var transitionResult = d.transitionQuestionPhase({
                questionId: e.record.id,
                nextPhase: effectiveStatus,
                transitionType: 'question_created',
                sourceRecordId: e.record.id,
                occurredAt: effectiveOccurredAt,
                force: true,
                metadata: {
                    title: title,
                    author: author
                }
            });
            d.logHookInfo('questions.create.transition_result', {
                questionId: String(e.record && e.record.id ? e.record.id : ''),
                targetPhase: String(effectiveStatus || ''),
                changed: transitionResult && transitionResult.changed === true,
                reason: String(transitionResult && transitionResult.reason || ''),
                currentPhase: String(transitionResult && transitionResult.currentPhase || ''),
                nextPhase: String(transitionResult && transitionResult.nextPhase || ''),
                phaseRecordId: String(transitionResult && transitionResult.phaseRecordId || ''),
                assertionTargetMatches: String(transitionResult && transitionResult.nextPhase || '') === String(effectiveStatus || ''),
                assertionRaceNoopAllowed:
                    String(transitionResult && transitionResult.reason || '') === 'already_open_phase_record' ||
                    String(transitionResult && transitionResult.reason || '') === 'already_in_phase'
            });
            if (
                String(transitionResult && transitionResult.nextPhase || '') !== String(effectiveStatus || '') &&
                String(transitionResult && transitionResult.reason || '') !== 'already_open_phase_record' &&
                String(transitionResult && transitionResult.reason || '') !== 'already_in_phase'
            ) {
                d.logHookError('questions.create.transition_assertion_failed', new Error('phase transition target mismatch'), {
                    questionId: String(e.record && e.record.id ? e.record.id : ''),
                    targetPhase: String(effectiveStatus || ''),
                    transitionReason: String(transitionResult && transitionResult.reason || ''),
                    transitionNextPhase: String(transitionResult && transitionResult.nextPhase || '')
                });
            }
        });
        console.log('[questions.create] hook completed');
    } catch (error) {
        console.log('[questions.create] catch: ' + String((error && error.message) || error));
        if (typeof d.logHookError === 'function') {
            d.logHookError('questions.create', error, {
                authId: d.tryCatch(function() {
                    return e && e.auth && e.auth.id ? e.auth.id : '';
                }, ''),
                recordId: e.record && e.record.id ? e.record.id : '',
                title: String(e.record && e.record.get('title') || ''),
                author: String(e.record && e.record.get('author') || '')
            });
        } else {
            console.log('[hook-error] scope=questions.create message=' + String((error && error.message) || error));
        }
        // Re-throw original error so PocketBase can return field-level validation details.
        throw error;
    }
}, "questions");

onRecordUpdateRequest(function(e) {
    var d = require($filepath.join(__hooks, "utils", "runtime.js")).resolve();

    try {
        if (d.isInternal(e) || d.isAdminAuth(e) || e.record.get('__is_transition')) {
            e.next();
            return;
        }
        var persisted = d.tryCatch(function() {
            return $app.findRecordById('questions', e.record.id);
        });
        d.assert(!!persisted, 'Question not found.');

        if (e.record.get('current_phase') !== persisted.get('current_phase')) {
            e.next();
            return;
        }

        d.tryCatch(function() {
            var status = d.getCurrentQuestionPhase(persisted);
            d.assert(
                status !== d.PHASE_FINAL_VOTE,
                'Questions in Final Vote phase are immutable.'
            );
        });
        e.next();
    } catch (error) {
        console.log('[questions.update] catch: ' + String((error && error.message) || error));
        if (typeof d.logHookError === 'function') {
            d.logHookError('questions.update', error, {
                recordId: e.record && e.record.id ? e.record.id : ''
            });
        } else {
            console.log('[hook-error] scope=questions.update message=' + String((error && error.message) || error));
        }
        throw error;
    }
}, "questions");
