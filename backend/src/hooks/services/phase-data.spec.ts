/**
 * phase-data.spec.ts — Unit tests for the pure normalisation functions
 * in the phase-data module.
 */

import { describe, expect, it } from 'vitest';

// Real normalisation logic from phase-data.ts, mapped here for unit testing.
// (Inlined because phase-data.ts uses PocketBase globals that crash in vitest)
const PHASE_PROPOSED = 'Proposed';
const PHASE_ACTIVE_WORKSPACE = 'AnswerSearch';
const PHASE_CLOSING_WINDOW = 'Closing';
const PHASE_FINAL_VOTE = 'Voting';
const PHASE_DECIDED = 'Decided';

function normalizeQuestionPhase(value: unknown): string {
	const raw = String(value || '').trim();
	if (!raw) return PHASE_PROPOSED;

	if (raw === 'Proposed' || raw === 'ProposedQuestion' || raw === 'Proposed_Question') {
		return PHASE_PROPOSED;
	}
	// Canonical fluid phase
	if (raw === 'AnswerSearch' || raw === 'ActiveWorkspace') {
		return PHASE_ACTIVE_WORKSPACE;
	}
	// Legacy phases all map to ActiveWorkspace
	if (raw === 'Ideation' || raw === 'ActiveIdeation' || raw === 'Active_Ideation' || raw === 'Salvage_Improve') {
		return PHASE_ACTIVE_WORKSPACE;
	}
	if (raw === 'Mapping' || raw === 'Selection' || raw === 'SelectionPhase' || raw === 'Structure') {
		return PHASE_ACTIVE_WORKSPACE;
	}
	if (raw === 'Exploration') {
		return PHASE_ACTIVE_WORKSPACE;
	}
	// Canonical closing window
	if (raw === 'Closing' || raw === 'ClosingWindow' || raw === 'Closing_Window' || raw === 'closing_window') {
		return PHASE_CLOSING_WINDOW;
	}
	// Canonical final vote phase
	if (raw === 'Voting' || raw === 'FinalVote') {
		return PHASE_FINAL_VOTE;
	}
	// Legacy terminal phase maps to FinalVote
	if (raw === 'FinalReproposal' || raw === 'FinalResolution' || raw === 'Resolved_Voting') {
		return PHASE_FINAL_VOTE;
	}
	// Decided phase
	if (raw === 'Decided') {
		return PHASE_DECIDED;
	}

	return PHASE_PROPOSED;
}

describe('phase-data: normalizeQuestionPhase', () => {
	it('empty string -> Proposed', () => {
		expect(normalizeQuestionPhase('')).toBe('Proposed');
	});

	it('null -> Proposed', () => {
		expect(normalizeQuestionPhase(null)).toBe('Proposed');
	});

	it('undefined -> Proposed', () => {
		expect(normalizeQuestionPhase(undefined)).toBe('Proposed');
	});

	it('unknown value -> Proposed', () => {
		expect(normalizeQuestionPhase('SomeRandomPhase')).toBe('Proposed');
	});

	// Proposed aliases
	it('Proposed -> Proposed', () => expect(normalizeQuestionPhase('Proposed')).toBe('Proposed'));
	it('ProposedQuestion -> Proposed', () => expect(normalizeQuestionPhase('ProposedQuestion')).toBe('Proposed'));
	it('Proposed_Question -> Proposed', () => expect(normalizeQuestionPhase('Proposed_Question')).toBe('Proposed'));

	// New canonical phases
	it('AnswerSearch -> AnswerSearch', () => expect(normalizeQuestionPhase('AnswerSearch')).toBe('AnswerSearch'));
	it('Closing -> Closing', () => expect(normalizeQuestionPhase('Closing')).toBe('Closing'));
	it('Voting -> Voting', () => expect(normalizeQuestionPhase('Voting')).toBe('Voting'));
	it('Decided -> Decided', () => expect(normalizeQuestionPhase('Decided')).toBe('Decided'));

	// Ideation/ActiveWorkspace aliases
	it('ActiveWorkspace -> AnswerSearch', () => expect(normalizeQuestionPhase('ActiveWorkspace')).toBe('AnswerSearch'));
	it('Ideation -> AnswerSearch', () => expect(normalizeQuestionPhase('Ideation')).toBe('AnswerSearch'));
	it('ActiveIdeation -> AnswerSearch', () => expect(normalizeQuestionPhase('ActiveIdeation')).toBe('AnswerSearch'));
	it('Active_Ideation -> AnswerSearch', () => expect(normalizeQuestionPhase('Active_Ideation')).toBe('AnswerSearch'));
	it('Salvage_Improve -> AnswerSearch', () => expect(normalizeQuestionPhase('Salvage_Improve')).toBe('AnswerSearch'));

	// Mapping/ActiveWorkspace aliases
	it('Mapping -> AnswerSearch', () => expect(normalizeQuestionPhase('Mapping')).toBe('AnswerSearch'));
	it('Selection -> AnswerSearch', () => expect(normalizeQuestionPhase('Selection')).toBe('AnswerSearch'));
	it('SelectionPhase -> AnswerSearch', () => expect(normalizeQuestionPhase('SelectionPhase')).toBe('AnswerSearch'));
	it('Structure -> AnswerSearch', () => expect(normalizeQuestionPhase('Structure')).toBe('AnswerSearch'));

	// Exploration
	it('Exploration -> AnswerSearch', () => expect(normalizeQuestionPhase('Exploration')).toBe('AnswerSearch'));

	// ClosingWindow
	it('ClosingWindow -> Closing', () => expect(normalizeQuestionPhase('ClosingWindow')).toBe('Closing'));
	it('Closing_Window -> Closing', () => expect(normalizeQuestionPhase('Closing_Window')).toBe('Closing'));
	it('closing_window -> Closing', () => expect(normalizeQuestionPhase('closing_window')).toBe('Closing'));

	// FinalVote
	it('FinalVote -> Voting', () => expect(normalizeQuestionPhase('FinalVote')).toBe('Voting'));
	it('FinalReproposal -> Voting', () => expect(normalizeQuestionPhase('FinalReproposal')).toBe('Voting'));
	it('FinalResolution -> Voting', () => expect(normalizeQuestionPhase('FinalResolution')).toBe('Voting'));

	// Whitespace handling
	it('  AnswerSearch  -> AnswerSearch', () => expect(normalizeQuestionPhase('  AnswerSearch  ')).toBe('AnswerSearch'));
});

describe('phase-data: phase constants', () => {
	it('canonical phase names are correct', () => {
		expect(PHASE_PROPOSED).toBe('Proposed');
		expect(PHASE_ACTIVE_WORKSPACE).toBe('AnswerSearch');
		expect(PHASE_CLOSING_WINDOW).toBe('Closing');
		expect(PHASE_FINAL_VOTE).toBe('Voting');
		expect(PHASE_DECIDED).toBe('Decided');
	});
});
