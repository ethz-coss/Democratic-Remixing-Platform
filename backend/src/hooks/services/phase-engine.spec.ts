import { describe, expect, it } from 'vitest';
import {
	evaluateActivationTransition,
	evaluatePhaseDeadline,
	evaluateTransition,
	getPhaseTransitions,
	getCanonicalPhases,
	toCanonical,
	type QuestionPhase,
	type CanonicalPhase
} from './phase-engine';

// ─── Canonical phase mapping ────────────────────────────────────────────

describe('phase-engine.toCanonical', () => {
	it('maps Proposed → Proposed', () => {
		expect(toCanonical('Proposed')).toBe('Proposed');
	});

	it('maps ActiveWorkspace → ActiveWorkspace', () => {
		expect(toCanonical('AnswerSearch')).toBe('AnswerSearch');
	});

	it('maps FinalVote → FinalVote', () => {
		expect(toCanonical('Voting')).toBe('Voting');
	});

	it('maps legacy Ideation → ActiveWorkspace', () => {
		expect(toCanonical('Ideation')).toBe('AnswerSearch');
	});

	it('maps legacy Mapping → ActiveWorkspace', () => {
		expect(toCanonical('Mapping')).toBe('AnswerSearch');
	});

	it('maps legacy Exploration → ActiveWorkspace', () => {
		expect(toCanonical('Exploration')).toBe('AnswerSearch');
	});

	it('maps legacy FinalReproposal → Voting', () => {
		expect(toCanonical('FinalReproposal')).toBe('Voting');
	});
});

// ─── Transition map ─────────────────────────────────────────────────────

const CANONICAL: CanonicalPhase[] = ['Proposed', 'AnswerSearch', 'Closing', 'Voting', 'Decided'];

const EXPECTED_ALLOWED: [CanonicalPhase, CanonicalPhase][] = [
	['Proposed', 'AnswerSearch'],
	['AnswerSearch', 'Closing'],
	['Closing', 'Voting'],
	['Voting', 'Decided']
];

describe('phase-engine.evaluateTransition: exhaustive canonical matrix', () => {
	const allowedSet = new Set(EXPECTED_ALLOWED.map(([from, to]) => `${from}->${to}`));

	for (const from of CANONICAL) {
		for (const to of CANONICAL) {
			if (from === to) continue;
			const key = `${from}->${to}`;
			const shouldAllow = allowedSet.has(key);

			it(`${key} should be ${shouldAllow ? 'ALLOWED' : 'REJECTED'}`, () => {
				const result = evaluateTransition({ currentPhase: from, nextPhase: to });
				expect(result.allowed).toBe(shouldAllow);
				if (shouldAllow) {
					expect(result.reason).toBe('ok');
				} else {
					expect(result.reason).toBe('disallowed_transition');
				}
			});
		}
	}
});

describe('phase-engine.evaluateTransition: legacy phases normalise correctly', () => {
	it('Ideation→Mapping is same_phase (both ActiveWorkspace)', () => {
		const result = evaluateTransition({ currentPhase: 'Ideation', nextPhase: 'Mapping' });
		expect(result.allowed).toBe(false);
		expect(result.reason).toBe('same_phase');
	});

	it('Ideation→Mapping with allowNoop', () => {
		const result = evaluateTransition({ currentPhase: 'Ideation', nextPhase: 'Mapping', allowNoop: true });
		expect(result.allowed).toBe(true);
		expect(result.reason).toBe('same_phase');
	});

	it('Proposed→Ideation allowed (Proposed→ActiveWorkspace)', () => {
		const result = evaluateTransition({ currentPhase: 'Proposed', nextPhase: 'Ideation' });
		expect(result.allowed).toBe(true);
		expect(result.reason).toBe('ok');
	});

	it('Ideation→FinalReproposal rejected (ActiveWorkspace→FinalVote directly is disallowed)', () => {
		const result = evaluateTransition({ currentPhase: 'Ideation', nextPhase: 'Decided' });
		expect(result.allowed).toBe(false);
		expect(result.reason).toBe('disallowed_transition');
	});

	it('FinalReproposal→Ideation rejected (FinalVote→ActiveWorkspace)', () => {
		const result = evaluateTransition({ currentPhase: 'Decided', nextPhase: 'Ideation' });
		expect(result.allowed).toBe(false);
		expect(result.reason).toBe('disallowed_transition');
	});
});

describe('phase-engine.evaluateTransition: same-phase transitions', () => {
	for (const phase of CANONICAL) {
		it(`${phase}->${phase} is rejected without allowNoop`, () => {
			const result = evaluateTransition({ currentPhase: phase, nextPhase: phase });
			expect(result.allowed).toBe(false);
			expect(result.reason).toBe('same_phase');
		});

		it(`${phase}->${phase} is allowed with allowNoop`, () => {
			const result = evaluateTransition({ currentPhase: phase, nextPhase: phase, allowNoop: true });
			expect(result.allowed).toBe(true);
			expect(result.reason).toBe('same_phase');
		});
	}
});

describe('phase-engine.evaluateTransition: force flag overrides everything', () => {
	const disallowed: [CanonicalPhase, CanonicalPhase][] = [
		['Voting', 'Proposed'],
		['Voting', 'AnswerSearch'],
		['AnswerSearch', 'Proposed'],
		['Proposed', 'Voting']
	];

	for (const [from, to] of disallowed) {
		it(`force: ${from}->${to}`, () => {
			const result = evaluateTransition({ currentPhase: from, nextPhase: to, force: true });
			expect(result.allowed).toBe(true);
			expect(result.reason).toBe('forced');
		});
	}
});

describe('phase-engine.evaluateTransition: lifecycle scenario', () => {
	it('full lifecycle: Proposed → AnswerSearch → Closing → Voting → Decided', () => {
		const steps: [CanonicalPhase, CanonicalPhase][] = [
			['Proposed', 'AnswerSearch'],
			['AnswerSearch', 'Closing'],
			['Closing', 'Voting'],
			['Voting', 'Decided']
		];

		let current: CanonicalPhase = 'Proposed';
		for (const [from, to] of steps) {
			expect(current).toBe(from);
			const result = evaluateTransition({ currentPhase: from, nextPhase: to });
			expect(result.allowed).toBe(true);
			current = to;
		}
		expect(current).toBe('Decided');
	});

	it('Decided is terminal — no transitions allowed', () => {
		for (const to of CANONICAL) {
			if (to === 'Decided') continue;
			const result = evaluateTransition({ currentPhase: 'Decided', nextPhase: to });
			expect(result.allowed).toBe(false);
		}
	});
});

// ─── Activation ─────────────────────────────────────────────────────────

describe('phase-engine.evaluateActivationTransition', () => {
	it('keeps Proposed below threshold', () => {
		const result = evaluateActivationTransition({
			currentPhase: 'Proposed',
			score: 9,
			activationThreshold: 10
		});
		expect(result.nextPhase).toBe('Proposed');
		expect(result.changed).toBe(false);
	});

	it('transitions Proposed to ActiveWorkspace at threshold', () => {
		const result = evaluateActivationTransition({
			currentPhase: 'Proposed',
			score: 10,
			activationThreshold: 10
		});
		expect(result.nextPhase).toBe('AnswerSearch');
		expect(result.changed).toBe(true);
	});

	it('transitions Proposed to ActiveWorkspace above threshold', () => {
		const result = evaluateActivationTransition({
			currentPhase: 'Proposed',
			score: 11,
			activationThreshold: 10
		});
		expect(result.nextPhase).toBe('AnswerSearch');
		expect(result.changed).toBe(true);
	});

	it('does not move FinalVote by score refresh', () => {
		const result = evaluateActivationTransition({
			currentPhase: 'Voting',
			score: 100,
			activationThreshold: 10
		});
		expect(result.nextPhase).toBe('Voting');
		expect(result.reason).toBe('unchanged_locked_phase');
	});

	it('ActiveWorkspace is non-reversible', () => {
		const result = evaluateActivationTransition({
			currentPhase: 'AnswerSearch',
			score: 0,
			activationThreshold: 10
		});
		expect(result.nextPhase).toBe('AnswerSearch');
		expect(result.changed).toBe(false);
		expect(result.reason).toBe('unchanged_non_reversible_phase');
	});

	it('Legacy Ideation maps to ActiveWorkspace (non-reversible)', () => {
		const result = evaluateActivationTransition({
			currentPhase: 'Ideation',
			score: 0,
			activationThreshold: 10
		});
		expect(result.nextPhase).toBe('Ideation');
		expect(result.changed).toBe(false);
		expect(result.reason).toBe('unchanged_non_reversible_phase');
	});

	it('Legacy Mapping maps to ActiveWorkspace (non-reversible)', () => {
		const result = evaluateActivationTransition({
			currentPhase: 'Mapping',
			score: 0,
			activationThreshold: 10
		});
		expect(result.nextPhase).toBe('Mapping');
		expect(result.changed).toBe(false);
		expect(result.reason).toBe('unchanged_non_reversible_phase');
	});
});


// ─── Phase deadline ─────────────────────────────────────────────────────

describe('phase-engine.evaluatePhaseDeadline', () => {
	it('elapsed when past deadline', () => {
		const result = evaluatePhaseDeadline({
			deadlineAt: '2026-01-01T00:00:00Z',
			nowMs: Date.parse('2026-06-01T00:00:00Z')
		});
		expect(result.elapsed).toBe(true);
		expect(result.reason).toBe('deadline_elapsed');
	});

	it('pending when before deadline', () => {
		const result = evaluatePhaseDeadline({
			deadlineAt: '2030-01-01T00:00:00Z',
			nowMs: Date.parse('2026-01-01T00:00:00Z')
		});
		expect(result.elapsed).toBe(false);
		expect(result.reason).toBe('deadline_pending');
	});

	it('no_deadline when empty', () => {
		const result = evaluatePhaseDeadline({ deadlineAt: '', nowMs: Date.now() });
		expect(result.elapsed).toBe(false);
		expect(result.reason).toBe('no_deadline');
	});

	it('no_deadline when invalid', () => {
		const result = evaluatePhaseDeadline({ deadlineAt: 'not-a-date', nowMs: Date.now() });
		expect(result.elapsed).toBe(false);
		expect(result.reason).toBe('no_deadline');
	});

	it('elapsed when now == deadline exactly', () => {
		const ms = Date.parse('2026-06-15T12:00:00Z');
		const result = evaluatePhaseDeadline({
			deadlineAt: '2026-06-15T12:00:00Z',
			nowMs: ms
		});
		expect(result.elapsed).toBe(true);
		expect(result.reason).toBe('deadline_elapsed');
	});
});

// ─── Transition map integrity ───────────────────────────────────────────

describe('phase-engine.getPhaseTransitions', () => {
	it('exports canonical transition map with 3 phases', () => {
		const transitions = getPhaseTransitions();
		expect(transitions).toHaveProperty('Proposed');
		expect(transitions).toHaveProperty('AnswerSearch');
		expect(transitions).toHaveProperty('Voting');
	});

	it('Decided has no outgoing transitions', () => {
		const transitions = getPhaseTransitions();
		expect(Object.keys(transitions.Decided)).toHaveLength(0);
	});

	it('total allowed transition count is exactly 4', () => {
		const transitions = getPhaseTransitions();
		let count = 0;
		for (const from of CANONICAL) {
			count += Object.keys(transitions[from] || {}).length;
		}
		expect(count).toBe(4);
	});
});

describe('phase-engine.getCanonicalPhases', () => {
	it('returns exactly 4 canonical phases', () => {
		const phases = getCanonicalPhases();
		expect(phases).toEqual(['Proposed', 'AnswerSearch', 'Closing', 'Voting', 'Decided']);
	});
});
