/**
 * phase-engine.ts — Pure, side-effect-free transition logic for the Fluid Workspace model.
 *
 * State machine:  Proposed → ActiveWorkspace → FinalVote
 *
 * Legacy phase names (Ideation, Mapping, Exploration, FinalReproposal) are kept in the
 * QuestionPhase union so that historical records and normalization still work, but
 * the PHASE_TRANSITIONS map only allows the three canonical transitions.
 */

// Canonical phases + legacy aliases (kept for backward compat / normalization)
export type QuestionPhase =
	| 'Proposed'
	| 'AnswerSearch'
	| 'Closing'
	| 'Voting'
	| 'Decided'
	// Legacy aliases — normalised away at the data layer but accepted here
	| 'Ideation'
	| 'Mapping'
	| 'Exploration'
	| 'FinalReproposal'
	| 'FinalResolution';

export type CanonicalPhase = 'Proposed' | 'AnswerSearch' | 'Closing' | 'Voting' | 'Decided';

export type TransitionCheckInput = {
	currentPhase: QuestionPhase;
	nextPhase: QuestionPhase;
	force?: boolean;
	allowNoop?: boolean;
};

export type TransitionCheckResult = {
	allowed: boolean;
	currentPhase: QuestionPhase;
	nextPhase: QuestionPhase;
	reason: 'ok' | 'forced' | 'same_phase' | 'disallowed_transition';
};

export type ActivationContext = {
	currentPhase: QuestionPhase;
	score: number;
	activationThreshold: number;
};

export type ActivationResult = {
	nextPhase: QuestionPhase;
	changed: boolean;
	reason:
		| 'unchanged_locked_phase'
		| 'unchanged_non_reversible_phase'
		| 'score_above_threshold'
		| 'score_below_threshold';
};

export type PhaseDeadlineContext = {
	deadlineAt: string;
	nowMs: number;
};

export type PhaseDeadlineDecision = {
	elapsed: boolean;
	reason: 'deadline_elapsed' | 'no_deadline' | 'deadline_pending';
};

// ─── Canonical transition map ─────────────────────────────────────────────

const PHASE_TRANSITIONS: Record<CanonicalPhase, Partial<Record<CanonicalPhase, true>>> = {
	Proposed: {
		AnswerSearch: true
	},
	AnswerSearch: {
		Closing: true
	},
	Closing: {
		Voting: true
	},
	Voting: {
		Decided: true
	},
	Decided: {}
};

// ─── Canonical phase set ──────────────────────────────────────────────────

const CANONICAL_PHASES: CanonicalPhase[] = ['Proposed', 'AnswerSearch', 'Closing', 'Voting', 'Decided'];

// ─── Legacy → canonical mapping ──────────────────────────────────────────

function toCanonical(phase: QuestionPhase): CanonicalPhase {
	switch (phase) {
		case 'Proposed':
			return 'Proposed';
		case 'AnswerSearch':
		case 'Ideation':
		case 'Mapping':
		case 'Exploration':
			return 'AnswerSearch';
		case 'Closing':
			return 'Closing';
		case 'Voting':
		case 'FinalReproposal':
		case 'FinalResolution':
			return 'Voting';
		case 'Decided':
			return 'Decided';
		default:
			return 'Proposed';
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function safeNatural(value: number, fallback: number): number {
	const rounded = Math.round(Number(value));
	if (!Number.isFinite(rounded) || rounded < 1) {
		return fallback;
	}
	return rounded;
}

// ─── Exports ──────────────────────────────────────────────────────────────

export function getPhaseTransitions() {
	return PHASE_TRANSITIONS;
}

export function getCanonicalPhases(): CanonicalPhase[] {
	return CANONICAL_PHASES;
}

export { toCanonical };

export function evaluateTransition(input: TransitionCheckInput): TransitionCheckResult {
	const currentCanonical = toCanonical(input.currentPhase);
	const nextCanonical = toCanonical(input.nextPhase);

	if (input.force === true) {
		return {
			allowed: true,
			currentPhase: input.currentPhase,
			nextPhase: input.nextPhase,
			reason: 'forced'
		};
	}

	if (currentCanonical === nextCanonical) {
		return {
			allowed: input.allowNoop === true,
			currentPhase: input.currentPhase,
			nextPhase: input.nextPhase,
			reason: 'same_phase'
		};
	}

	const transitions = PHASE_TRANSITIONS[currentCanonical] || {};
	const allowed = transitions[nextCanonical] === true;
	return {
		allowed,
		currentPhase: input.currentPhase,
		nextPhase: input.nextPhase,
		reason: allowed ? 'ok' : 'disallowed_transition'
	};
}

export function evaluateActivationTransition(context: ActivationContext): ActivationResult {
	const canonical = toCanonical(context.currentPhase);

	// ActiveWorkspace and FinalVote are locked — no activation re-evaluation
	if (canonical === 'AnswerSearch' || canonical === 'Closing') {
		return {
			nextPhase: context.currentPhase,
			changed: false,
			reason: 'unchanged_non_reversible_phase'
		};
	}

	if (canonical === 'Voting' || canonical === 'Decided') {
		return {
			nextPhase: context.currentPhase,
			changed: false,
			reason: 'unchanged_locked_phase'
		};
	}

	// Proposed → ActiveWorkspace on score threshold
	const threshold = safeNatural(context.activationThreshold, 10);
	if (Number(context.score) >= threshold) {
		return {
			nextPhase: 'AnswerSearch',
			changed: true,
			reason: 'score_above_threshold'
		};
	}

	return {
		nextPhase: 'Proposed',
		changed: false,
		reason: 'score_below_threshold'
	};
}


/**
 * Shared phase deadline evaluator. Checks whether a phase's deadline_at
 * timestamp has elapsed. Reusable for any timed deadline.
 */
export function evaluatePhaseDeadline(context: PhaseDeadlineContext): PhaseDeadlineDecision {
	const deadlineMs = Date.parse(String(context.deadlineAt || ''));
	if (!Number.isFinite(deadlineMs)) {
		return {
			elapsed: false,
			reason: 'no_deadline'
		};
	}

	if (context.nowMs >= deadlineMs) {
		return {
			elapsed: true,
			reason: 'deadline_elapsed'
		};
	}

	return {
		elapsed: false,
		reason: 'deadline_pending'
	};
}