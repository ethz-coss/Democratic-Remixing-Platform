import * as m from '$lib/paraglide/messages.js';
import type { Component } from 'svelte';
import {
	FileText,
	Wrench,
	Star,
	ArrowUp,
	Swords,
	BookOpen,
	Merge,
	ClipboardList,
	Users,
	NotebookPen,
	Settings,
	Globe,
	Pencil,
	ThumbsUp,
	Link,
	Target,
	Puzzle,
	Lightbulb,
	Info,
	Trophy,
	Sparkles,
	Zap,
	GitBranch,
	Map,
	CheckCircle,
	Bell,
	MessageSquare,
	AlertTriangle,
	X,
	Check,
	Circle,
	Bot,
	Smartphone,
	Share,
	ChevronDown,
	ChevronUp,
	ChevronRight,
	Reply,
	Plus,
	Clock,
	Vote,
	ListChecks,
	Compass
} from '@lucide/svelte';

export const ICON_QUESTION = ClipboardList;
export const ICON_DISCOVER = Compass;
export const ICON_IDEA = Lightbulb;
export const ICON_REMIX = GitBranch;
export const ICON_COMPARE = Merge;
export const ICON_SUBSCRIBE = Bell;
export const ICON_BALLOT = ListChecks;
export const ICON_CHAMPION = Star;
const ICON_FOCUS = Target;
export const ICON_RESULTS = Trophy;

// --- Backward Compatibility Aliases ---
export const ICON_PROPOSAL = ICON_IDEA;
export const ICON_IMPROVE = ICON_REMIX;
export const ICON_COMBINE = ICON_COMPARE;
export const ICON_MERGE = ICON_COMPARE;
const ICON_VOTE = ICON_SUBSCRIBE;
const ICON_LEADING = ICON_CHAMPION;

export const PHASE_ICON: Record<string, Component> = {
	Proposed: FileText,
	AnswerSearch: Lightbulb,
	Closing: Clock,
	Voting: Vote,
	Decided: CheckCircle
};

// Translatable domain terms — call these as functions: TERM_IDEA()
const TERM_IDEA = () => m.term_proposal();
export const TERM_REMIX = () => m.term_improve();
export const TERM_PROPOSALS = () => m.term_proposals();

const TERM_LABEL = () => m.term_theme();
const TERM_BALLOT = () => m.term_ballot();
const TERM_SUBSCRIBE = () => m.term_support();

// --- Backward Compatibility Aliases ---
export const TERM_PROPOSAL = TERM_IDEA;
const TERM_IMPROVE = TERM_REMIX;
const TERM_COMBINE = () => m.term_combine();
export const TERM_LEADING_IDEA = () => m.discovery_filter_leading_ideas();
const TERM_SUPPORT = TERM_SUBSCRIBE;

export function PHASE_LABEL(phase: string): string {
	switch (phase) {
		case 'Proposed':
			return m.phase_proposed();
		case 'AnswerSearch':
			return m.phase_answer_search();
		case 'Closing':
			return m.phase_closing();
		case 'Voting':
			return m.phase_voting();
		case 'Decided':
			return m.phase_decided();
		default:
			return phase;
	}
}
