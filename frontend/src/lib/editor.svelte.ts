/**
 * Global editor state — a Svelte 5 runes-based state machine
 * controlling the unified Proposal Editor Sheet.
 *
 * Phases: closed | root | compare | combine | improve
 */

import { logAction } from '$lib/services/telemetry';

type EditorPhase = 'closed' | 'compare' | 'combine' | 'improve';

interface ParentFeedbackItem {
	content: string;
	upvote_count: number;
	author_name: string;
	parent_proposal_title: string;
}

class EditorStore {
	constructor() {
		if (typeof window !== 'undefined') {
			try {
				const saved = localStorage.getItem('comparePool');
				if (saved) {
					this.comparePool = JSON.parse(saved);
				}
			} catch (e) {
				console.error('Failed to load comparePool from localStorage', e);
			}

			// Watch for changes and save to localStorage
			$effect.root(() => {
				$effect(() => {
					localStorage.setItem('comparePool', JSON.stringify(this.comparePool));
				});
			});
		}
	}

	phase = $state<EditorPhase>('closed');

	// Pool of proposals selected for comparison
	comparePool = $state<App.ProposalRecord[]>([]);

	// For improve mode, the selected parent
	parentA = $state<App.ProposalRecord | null>(null);
	parentB = $state<App.ProposalRecord | null>(null);
	parentFeedback = $state<ParentFeedbackItem[]>([]);

	/** Compare state: toggle to highlight differences */
	showDiffHighlight = $state(false);

	/** Source comparison metadata */
	sourceComparisonMeta = $state<{
		childId: string;
		sourceIds: string[];
		reasonForChange: string;
	} | null>(null);

	/** Combine flow prefill data */
	_combinePrefill = $state<{
		title: string;
		content: string;
		rationale: string;
	} | null>(null);

	get isSourceComparison() {
		return this.sourceComparisonMeta !== null;
	}

	get isOpen() {
		return this.phase !== 'closed';
	}

	// ---- Compare Pool Methods ----

	addToComparePool(proposal: App.ProposalRecord) {
		if (!this.comparePool.some((p) => p.id === proposal.id)) {
			this.comparePool = [...this.comparePool, proposal];
			logAction('compare_add', {
				target_id: proposal.id,
				question: proposal.question,
				metadata: { pool_size: this.comparePool.length }
			});
		}
	}

	removeFromComparePool(id: string) {
		this.comparePool = this.comparePool.filter((p) => p.id !== id);
		logAction('compare_remove', {
			target_id: id,
			metadata: { pool_size: this.comparePool.length }
		});
	}

	clearComparePool() {
		this.comparePool = [];
		this.sourceComparisonMeta = null;
	}

	// ---- Phase Transitions ----

	openCompareFromPool() {
		if (this.comparePool.length >= 1) {
			this.sourceComparisonMeta = null;
			this.phase = 'compare';
			logAction('compare_open', {
				metadata: {
					pool_size: this.comparePool.length,
					proposal_ids: this.comparePool.map((p) => p.id)
				}
			});
		}
	}

	enterImproveMode(parent: App.ProposalRecord, feedback?: ParentFeedbackItem[]) {
		this.phase = 'improve';
		this.parentA = parent;
		this.parentB = null;
		this.parentFeedback = feedback ?? [];
	}

	openSourceComparison(child: App.ProposalRecord, sources: App.ProposalRecord[]) {
		this.comparePool = [...sources, child];
		this.sourceComparisonMeta = {
			childId: child.id,
			sourceIds: sources.map((p) => p.id),
			reasonForChange: child.reason_for_change || ''
		};
		this.showDiffHighlight = true;
		this.phase = 'compare';
		logAction('compare_open', {
			target_id: child.id,
			metadata: { source_ids: sources.map((p) => p.id) }
		});
	}

	close() {
		this.phase = 'closed';
		this.parentA = null;
		this.parentB = null;
		this.parentFeedback = [];
		this.sourceComparisonMeta = null;
	}
}

export const editorState = new EditorStore();
