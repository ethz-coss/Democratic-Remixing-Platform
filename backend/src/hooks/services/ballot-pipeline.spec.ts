import { describe, expect, it } from 'vitest';
import { identifyChampions } from './label-engine.js';
import { selectBallot } from './ballot-engine.js';

describe('Ballot Pipeline: identifyChampions -> selectBallot', () => {
	it('5 labels, 15 proposals -> ballot has exactly 5 slots', () => {
		const proposals = Array.from({ length: 15 }).map((_, i) => ({
			id: `p${i}`,
			primary_label: `L${i % 5}`, // 5 labels
			labels: [`L${i % 5}`],
			subscription_count: i,
			created: '2026-01-01'
		}));

		const championsMap = identifyChampions(proposals);
		const champions = Object.values(championsMap);
		const ballot = selectBallot(champions, 7);

		expect(ballot.length).toBe(5);
		// The top 5 should be the ones with the highest subscription count per label
		// p14(L4)=14, p13(L3)=13, p12(L2)=12, p11(L1)=11, p10(L0)=10
		expect(ballot[0].id).toBe('p14');
		expect(ballot[4].id).toBe('p10');
	});

	it('10 labels, 30 proposals -> ballot capped at 7', () => {
		const proposals = Array.from({ length: 30 }).map((_, i) => ({
			id: `p${i}`,
			primary_label: `L${i % 10}`, // 10 labels
			labels: [`L${i % 10}`],
			subscription_count: i,
			created: '2026-01-01'
		}));

		const championsMap = identifyChampions(proposals);
		const champions = Object.values(championsMap);
		const ballot = selectBallot(champions, 7);

		expect(ballot.length).toBe(7);
	});

	it('3 labels but some have <2 subscription_count -> those are filtered from the ballot', () => {
		const proposals = [
			{ id: 'p1', primary_label: 'L1', labels: ['L1'], subscription_count: 5, created: '2026-01-01' },
			{ id: 'p2', primary_label: 'L2', labels: ['L2'], subscription_count: 1, created: '2026-01-01' },
			{ id: 'p3', primary_label: 'L3', labels: ['L3'], subscription_count: 0, created: '2026-01-01' }
		];

		const championsMap = identifyChampions(proposals);
		const champions = Object.values(championsMap);
		const ballot = selectBallot(champions, 7);

		expect(ballot.length).toBe(1);
		expect(ballot[0].id).toBe('p1');
	});

	it('All proposals in same label -> ballot has 1 slot', () => {
		const proposals = Array.from({ length: 10 }).map((_, i) => ({
			id: `p${i}`,
			primary_label: `L1`,
			labels: ['L1'],
			subscription_count: i,
			created: '2026-01-01'
		}));

		const championsMap = identifyChampions(proposals);
		const champions = Object.values(championsMap);
		const ballot = selectBallot(champions, 7);

		expect(ballot.length).toBe(1);
		expect(ballot[0].id).toBe('p9');
	});

	it('Label diversity: 7 labels with 2 subscribers each beats 1 label with 100 subscribers', () => {
		// Simulating 1 massive idea in L1, and 6 small ideas in L2-L7.
		// There are more ideas in L1 with high scores (99, 98), but they should be filtered out
		// because L1 only gets 1 champion.
		const proposals = [
			{ id: 'giant', primary_label: 'L1', labels: ['L1'], subscription_count: 100, created: '2026-01-01' },
			{ id: 'runner_up1', primary_label: 'L1', labels: ['L1'], subscription_count: 99, created: '2026-01-01' },
			{ id: 'runner_up2', primary_label: 'L1', labels: ['L1'], subscription_count: 98, created: '2026-01-01' },
			{ id: 'small2', primary_label: 'L2', labels: ['L2'], subscription_count: 2, created: '2026-01-01' },
			{ id: 'small3', primary_label: 'L3', labels: ['L3'], subscription_count: 2, created: '2026-01-01' },
			{ id: 'small4', primary_label: 'L4', labels: ['L4'], subscription_count: 2, created: '2026-01-01' },
			{ id: 'small5', primary_label: 'L5', labels: ['L5'], subscription_count: 2, created: '2026-01-01' },
			{ id: 'small6', primary_label: 'L6', labels: ['L6'], subscription_count: 2, created: '2026-01-01' },
			{ id: 'small7', primary_label: 'L7', labels: ['L7'], subscription_count: 2, created: '2026-01-01' }
		];

		const championsMap = identifyChampions(proposals);
		const champions = Object.values(championsMap);
		const ballot = selectBallot(champions, 7);

		expect(ballot.length).toBe(7);
		expect(ballot[0].id).toBe('giant');
		expect(ballot.find(b => b.id === 'runner_up1')).toBeUndefined(); // Filtered by label diversity
		expect(ballot.find(b => b.id === 'small2')).toBeDefined();
	});

	it('Champion displacement: new idea surpasses old champion -> ballot updates', () => {
		const state1 = [
			{ id: 'old_champ', primary_label: 'L1', labels: ['L1'], subscription_count: 10, created: '2026-01-01' },
			{ id: 'new_idea', primary_label: 'L1', labels: ['L1'], subscription_count: 5, created: '2026-01-02' }
		];
		let champs = Object.values(identifyChampions(state1));
		let ballot = selectBallot(champs, 7);
		expect(ballot[0].id).toBe('old_champ');

		const state2 = [
			{ id: 'old_champ', primary_label: 'L1', labels: ['L1'], subscription_count: 10, created: '2026-01-01' },
			{ id: 'new_idea', primary_label: 'L1', labels: ['L1'], subscription_count: 15, created: '2026-01-02' } // Surpassed
		];
		champs = Object.values(identifyChampions(state2));
		ballot = selectBallot(champs, 7);
		expect(ballot[0].id).toBe('new_idea');
	});

	it('proposals without primary_label are excluded from champions', () => {
		const proposals = [
			{ id: 'p1', primary_label: '', labels: [], subscription_count: 10, created: '2026-01-01' },
			{ id: 'p2', primary_label: null, labels: [], subscription_count: 15, created: '2026-01-02' },
			{ id: 'p3', primary_label: undefined, labels: [], subscription_count: 20, created: '2026-01-03' },
			{ id: 'p4', primary_label: 'L1', labels: ['L1'], subscription_count: 5, created: '2026-01-04' }
		];

		const championsMap = identifyChampions(proposals);
		const champions = Object.values(championsMap);
		
		expect(champions.length).toBe(1);
		expect(champions[0].id).toBe('p4');
	});

	it('minimum 2 subscriptions for ballot eligibility', () => {
		const proposals = [
			{ id: 'p1', primary_label: 'L1', labels: ['L1'], subscription_count: 2, created: '2026-01-01' },
			{ id: 'p2', primary_label: 'L2', labels: ['L2'], subscription_count: 1, created: '2026-01-01' },
			{ id: 'p3', primary_label: 'L3', labels: ['L3'], subscription_count: 0, created: '2026-01-01' }
		];

		const championsMap = identifyChampions(proposals);
		const champions = Object.values(championsMap);
		const ballot = selectBallot(champions, 7);

		// Only p1 is eligible because it has >= 2 subscriptions
		expect(ballot.length).toBe(1);
		expect(ballot[0].id).toBe('p1');
	});

	// ── Label overlap exclusion in pipeline ──────────────────────────────

	it('Champions with overlapping secondary labels -> duplicate labels excluded from ballot', () => {
		// Idea A is champion of Housing, also tagged with Economics
		// Idea B is champion of Economics, also tagged with Transport
		// After A enters the ballot, B is excluded because Economics is already seen
		const proposals = [
			{ id: 'ideaA', primary_label: 'Housing', labels: ['Housing', 'Economics'], subscription_count: 10, created: '2026-01-01' },
			{ id: 'ideaA2', primary_label: 'Housing', labels: ['Housing'], subscription_count: 3, created: '2026-01-02' },
			{ id: 'ideaB', primary_label: 'Economics', labels: ['Economics', 'Transport'], subscription_count: 8, created: '2026-01-01' },
			{ id: 'ideaC', primary_label: 'Health', labels: ['Health'], subscription_count: 5, created: '2026-01-01' }
		];

		const championsMap = identifyChampions(proposals);
		const champions = Object.values(championsMap);
		const ballot = selectBallot(champions, 7);

		// ideaA (Housing champion) enters first
		// ideaB (Economics champion) blocked because Economics is in ideaA's labels
		// ideaC (Health champion) enters
		expect(ballot.length).toBe(2);
		expect(ballot[0].id).toBe('ideaA');
		expect(ballot[1].id).toBe('ideaC');
		expect(ballot.find(b => b.id === 'ideaB')).toBeUndefined();
	});

	it('Tie-breaking via label_support_score flows through the full pipeline', () => {
		// Two proposals with the same primary_label and subscription_count,
		// but different label_support_scores
		const proposals = [
			{ id: 'p1', primary_label: 'L1', labels: ['L1', 'Popular'], subscription_count: 5, created: '2026-01-02', label_support_score: 100 },
			{ id: 'p2', primary_label: 'L1', labels: ['L1'], subscription_count: 5, created: '2026-01-01', label_support_score: 20 }
		];

		const championsMap = identifyChampions(proposals);
		// p1 wins because it has higher label_support_score despite being newer
		expect(championsMap['L1'].id).toBe('p1');
	});
});
