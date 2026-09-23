/// <reference path="./pocketbase-globals.d.ts" />

cronAdd('attention_pool_refresh', '* * * * *', function () {
	var d = require($filepath.join(__hooks, 'utils', 'runtime.js')).resolve();
	var finalizationEngine = require($filepath.join(__hooks, 'services', 'finalization-engine.js'));

	d.logHookInfo('Running attention pool cron check', {});

	var activeQuestionsHelper = require($filepath.join(__hooks, '_shared', 'active-questions.js'));
	var activeQuestions = activeQuestionsHelper.getActiveQuestions(d);

	if (activeQuestions.length === 0) {
		return;
	}

	activeQuestions.forEach(function (question) {
		var questionId = d.extractId(question);
		var phaseName = String(question.get('current_phase_name') || '');

		if (phaseName === 'AnswerSearch') {
			var systemDeadlineAt = question.get('discussion_deadline');
			if (systemDeadlineAt && new Date(systemDeadlineAt) <= new Date()) {
				try {
					finalizationEngine.finalizeAnswerSearch($app, questionId);
				} catch (err) {
					d.logHookError('cron.finalizeAnswerSearch', err, { questionId: questionId });
				}
			}
		}

		if (phaseName === 'Closing') {
			var endsAt = question.get('closing_window_deadline');
			if (endsAt && new Date(endsAt) <= new Date()) {
				try {
					finalizationEngine.finalizeClosingWindow($app, questionId);
				} catch (err) {
					d.logHookError('cron.finalizeClosingWindow', err, { questionId: questionId });
				}
			}
		}

		if (phaseName === 'Voting') {
			var votingEndsAt = question.get('vote_deadline');
			if (votingEndsAt && new Date(votingEndsAt) <= new Date()) {
				try {
					finalizationEngine.finalizeVoting($app, questionId);
				} catch (err) {
					d.logHookError('cron.finalizeVoting', err, { questionId: questionId });
				}
			}
		}
	});
});
