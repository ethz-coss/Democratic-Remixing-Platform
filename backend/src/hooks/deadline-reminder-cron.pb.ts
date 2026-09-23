/// <reference path="./pocketbase-globals.d.ts" />

cronAdd('deadline_reminders', '*/5 * * * *', function () {
	var d = require($filepath.join(__hooks, 'utils', 'runtime.js')).resolve();
	var pushEngine = require($filepath.join(__hooks, 'services', 'push-notifications-engine.js'));

	d.logHookInfo('Running deadline reminder cron check', {});

	var activeQuestionsHelper = require($filepath.join(__hooks, '_shared', 'active-questions.js'));
	var activeQuestions = activeQuestionsHelper.getActiveQuestions(d);

	if (activeQuestions.length === 0) {
		return;
	}

	var now = Date.now();

	var endingSoonAnswerSearchHours = parseInt($os.getenv('ENDING_SOON_ANSWER_SEARCH_HOURS') || '24', 10);
	var endingSoonClosingHours = parseInt($os.getenv('ENDING_SOON_CLOSING_HOURS') || '6', 10);
	var endingSoonVotingHours = parseInt($os.getenv('ENDING_SOON_VOTING_HOURS') || '12', 10);

	activeQuestions.forEach(function (question) {
		var questionId = d.extractId(question);
		var phaseName = String(question.get('current_phase_name') || '');

		var deadlineStr = '';
		var phaseStartStr = '';
		var endingSoonHours = 0;

		if (phaseName === 'AnswerSearch') {
			deadlineStr = String(question.get('discussion_deadline') || '');
			phaseStartStr = String(question.get('created') || '');
			endingSoonHours = endingSoonAnswerSearchHours;
		} else if (phaseName === 'Closing') {
			deadlineStr = String(question.get('closing_window_deadline') || '');
			phaseStartStr = String(question.get('discussion_deadline') || '');
			endingSoonHours = endingSoonClosingHours;
		} else if (phaseName === 'Voting') {
			deadlineStr = String(question.get('vote_deadline') || '');
			phaseStartStr = String(question.get('closing_window_deadline') || '');
			endingSoonHours = endingSoonVotingHours;
		}

		if (!deadlineStr || !phaseStartStr) {
			return;
		}

		var deadlineMs = new Date(deadlineStr).getTime();
		var phaseStartMs = new Date(phaseStartStr).getTime();

		if (isNaN(deadlineMs) || isNaN(phaseStartMs) || phaseStartMs >= deadlineMs) {
			return;
		}

		var halfwayMs = phaseStartMs + (deadlineMs - phaseStartMs) / 2;
		var endingSoonMs = deadlineMs - endingSoonHours * 60 * 60 * 1000;

		var triggers = [];

		if (now >= halfwayMs && now < deadlineMs) {
			triggers.push('phase_halfway');
		}

		if (now >= endingSoonMs && now < deadlineMs) {
			triggers.push('phase_ending_soon');
		}

		triggers.forEach(function (eventType) {
			var referenceId = questionId + '_' + phaseName + '_' + eventType;

			var existingLogs = d.tryCatch(function () {
				return $app.findRecordsByFilter(
					'push_notification_log',
					'event_type = {:etype} && reference_id = {:ref}',
					'',
					1,
					0,
					{ etype: eventType, ref: referenceId }
				);
			}, []);

			if (existingLogs && existingLogs.length > 0) {
				// Already sent for this question + phase + type combo
				return;
			}

			try {
				pushEngine.handleDeadlineReminder(question, eventType, phaseName);
			} catch (err) {
				d.logHookError('cron.deadline_reminders', err, { questionId: questionId, eventType: eventType });
			}
		});
	});
});
