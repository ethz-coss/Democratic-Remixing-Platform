/// <reference path="../pocketbase-globals.d.ts" />

function getActiveQuestions(d: any): models.Record[] {
	return d.tryCatch(function () {
		return $app.findRecordsByFilter(
			'questions',
			'current_phase_name = "AnswerSearch" || current_phase_name = "Closing" || current_phase_name = "Voting"',
			'',
			1000,
			0
		);
	}, []);
}

module.exports = {
	getActiveQuestions: getActiveQuestions
};
