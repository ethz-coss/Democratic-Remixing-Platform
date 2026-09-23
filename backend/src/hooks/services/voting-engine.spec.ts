import { describe, expect, it } from 'vitest';
import { calculateBordaResults, BallotResponse } from './voting-engine.js';

describe('voting-engine: calculateBordaResults', () => {
	it('3 champions, 1 voter ranks all 3 -> Borda scores: 3, 2, 1', () => {
		const championIds = ['c1', 'c2', 'c3'];
		const ballots: BallotResponse[] = [
			{
				userId: 'u1',
				questionId: 'q1',
				isAbstention: false,
				ranks: [
					{ proposalId: 'c1', rank: 1 },
					{ proposalId: 'c2', rank: 2 },
					{ proposalId: 'c3', rank: 3 }
				]
			}
		];
		const result = calculateBordaResults(ballots, championIds);
		
		expect(result.totalBallots).toBe(1);
		expect(result.abstentions).toBe(0);
		expect(result.numChampions).toBe(3);
		expect(result.rankedProposals.length).toBe(3);
		
		const p1 = result.rankedProposals.find(p => p.proposalId === 'c1');
		expect(p1?.bordaScore).toBe(3);
		expect(p1?.firstPlaceVotes).toBe(1);
		expect(p1?.rankDistribution).toEqual([1, 0, 0]); // 1 voter ranked c1 first

		const p2 = result.rankedProposals.find(p => p.proposalId === 'c2');
		expect(p2?.bordaScore).toBe(2);
		expect(p2?.rankDistribution).toEqual([0, 1, 0]); // 1 voter ranked c2 second

		const p3 = result.rankedProposals.find(p => p.proposalId === 'c3');
		expect(p3?.bordaScore).toBe(1);
		expect(p3?.rankDistribution).toEqual([0, 0, 1]); // 1 voter ranked c3 third
	});

	it('5 champions, 3 voters all rank same order -> scores multiply correctly', () => {
		const championIds = ['c1', 'c2', 'c3', 'c4', 'c5'];
		const ranks = [
			{ proposalId: 'c1', rank: 1 },
			{ proposalId: 'c2', rank: 2 },
			{ proposalId: 'c3', rank: 3 },
			{ proposalId: 'c4', rank: 4 },
			{ proposalId: 'c5', rank: 5 }
		];
		const ballots: BallotResponse[] = [
			{ userId: 'u1', questionId: 'q1', isAbstention: false, ranks },
			{ userId: 'u2', questionId: 'q1', isAbstention: false, ranks },
			{ userId: 'u3', questionId: 'q1', isAbstention: false, ranks }
		];
		const result = calculateBordaResults(ballots, championIds);
		
		expect(result.rankedProposals.find(p => p.proposalId === 'c1')?.bordaScore).toBe(15); // 5 * 3
		expect(result.rankedProposals.find(p => p.proposalId === 'c2')?.bordaScore).toBe(12); // 4 * 3
	});

	it('Voter only ranks 2 of 5 -> unranked get 0 points', () => {
		const championIds = ['c1', 'c2', 'c3', 'c4', 'c5'];
		const ballots: BallotResponse[] = [
			{
				userId: 'u1',
				questionId: 'q1',
				isAbstention: false,
				ranks: [
					{ proposalId: 'c1', rank: 1 },
					{ proposalId: 'c2', rank: 2 }
				]
			}
		];
		const result = calculateBordaResults(ballots, championIds);
		
		expect(result.rankedProposals.find(p => p.proposalId === 'c1')?.bordaScore).toBe(5);
		expect(result.rankedProposals.find(p => p.proposalId === 'c2')?.bordaScore).toBe(4);
		expect(result.rankedProposals.find(p => p.proposalId === 'c3')?.bordaScore).toBe(0);
	});

	it('All voters abstain -> all scores = 0, abstentions = total', () => {
		const championIds = ['c1', 'c2'];
		const ballots: BallotResponse[] = [
			{ userId: 'u1', questionId: 'q1', isAbstention: true, ranks: [] },
			{ userId: 'u2', questionId: 'q1', isAbstention: true, ranks: [] }
		];
		const result = calculateBordaResults(ballots, championIds);
		
		expect(result.totalBallots).toBe(2);
		expect(result.abstentions).toBe(2);
		expect(result.rankedProposals[0].bordaScore).toBe(0);
		expect(result.rankedProposals[1].bordaScore).toBe(0);
	});

	it('Mix of abstentions and votes -> abstentions counted in total but give 0 points', () => {
		const championIds = ['c1', 'c2'];
		const ballots: BallotResponse[] = [
			{ userId: 'u1', questionId: 'q1', isAbstention: true, ranks: [] },
			{ userId: 'u2', questionId: 'q1', isAbstention: false, ranks: [{ proposalId: 'c1', rank: 1 }] }
		];
		const result = calculateBordaResults(ballots, championIds);
		
		expect(result.totalBallots).toBe(2);
		expect(result.abstentions).toBe(1);
		expect(result.rankedProposals.find(p => p.proposalId === 'c1')?.bordaScore).toBe(2);
		expect(result.rankedProposals.find(p => p.proposalId === 'c2')?.bordaScore).toBe(0);
	});

	it('Tie on Borda score -> broken by most 1st-place votes', () => {
		const championIds = ['c1', 'c2'];
		const ballots: BallotResponse[] = [
			// u1 ranks c1 1st (2pts), c2 2nd (1pt)
			{ userId: 'u1', questionId: 'q1', isAbstention: false, ranks: [{ proposalId: 'c1', rank: 1 }, { proposalId: 'c2', rank: 2 }] },
			// u2 ranks c2 2nd (1pt) - skips 1st
			{ userId: 'u2', questionId: 'q1', isAbstention: false, ranks: [{ proposalId: 'c2', rank: 2 }] }
		];
		// c1: 2pts, 1 first-place vote
		// c2: 2pts, 0 first-place votes
		const result = calculateBordaResults(ballots, championIds);
		
		expect(result.rankedProposals[0].proposalId).toBe('c1');
	});

	it('Tie on Borda + 1st-place -> broken by total votes', () => {
		const championIds = ['c1', 'c2', 'c3'];
		const ballots: BallotResponse[] = [
			// c1 gets 1st (3pts) -> Total 3pts, 1 first-place, 1 vote
			{ userId: 'u1', questionId: 'q1', isAbstention: false, ranks: [{ proposalId: 'c1', rank: 1 }] },
			// c2 gets 1st (3pts) -> Total 3pts, 1 first-place, 1 vote
			{ userId: 'u2', questionId: 'q1', isAbstention: false, ranks: [{ proposalId: 'c2', rank: 1 }] },
			// c3 gets 2nd (2pts), 3rd (1pt) -> Total 3pts, 0 first-place, 2 votes.
		];
		// Make c1 and c2 tie on points and 1st-place. 
		// Wait, let's construct a tie where one has more total votes:
		// c1: 1st place (3pts) => 3 pts, 1 first place, 1 total vote.
		// c2: 1st place (3pts) => 3 pts, 1 first place, 1 total vote.
		// Let's add more ballots:
		// c1 gets 1x1st(3), 0x2nd(0), 1x3rd(1) = 4 pts, 1 first, 2 votes
		// c2 gets 1x1st(3), 1x2nd(2), 0x3rd(0) = 5 pts. Not a tie.
		
		const tieBallots: BallotResponse[] = [
			// c1 gets 1x1st(3) + 1x3rd(1) = 4pts, 1 first, 2 votes
			{ userId: 'u1', questionId: 'q1', isAbstention: false, ranks: [{ proposalId: 'c1', rank: 1 }, { proposalId: 'c2', rank: 2 }, { proposalId: 'c3', rank: 3 }] },
			// To make c3 get 4pts, 1 first: 1x1st(3) + 0x2nd(0) + 1x3rd(1) = 4pts, 1 first, 2 votes.
			{ userId: 'u2', questionId: 'q1', isAbstention: false, ranks: [{ proposalId: 'c3', rank: 1 }, { proposalId: 'c2', rank: 2 }, { proposalId: 'c1', rank: 3 }] }
		];
		// Actually, let's construct it more explicitly:
		// We want equal borda, equal 1st place, different total votes.
		// A: 4 pts, 0 first place, 2 total votes (2x 2nd place = 2*2=4)
		// B: 4 pts, 0 first place, 4 total votes (4x 3rd place = 4*1=4)
		// Since A and B both have 0 1st place, tie breaker is total votes. B wins.
		const tbChampionIds = ['A', 'B', 'C']; // C is dummy to make max rank 3
		const tbBallots: BallotResponse[] = [
			{ userId: 'u1', questionId: 'q1', isAbstention: false, ranks: [{ proposalId: 'A', rank: 2 }] }, // 2pts
			{ userId: 'u2', questionId: 'q1', isAbstention: false, ranks: [{ proposalId: 'A', rank: 2 }] }, // 2pts. Total A=4pts, 2votes
			{ userId: 'u3', questionId: 'q1', isAbstention: false, ranks: [{ proposalId: 'B', rank: 3 }] }, // 1pt
			{ userId: 'u4', questionId: 'q1', isAbstention: false, ranks: [{ proposalId: 'B', rank: 3 }] }, // 1pt
			{ userId: 'u5', questionId: 'q1', isAbstention: false, ranks: [{ proposalId: 'B', rank: 3 }] }, // 1pt
			{ userId: 'u6', questionId: 'q1', isAbstention: false, ranks: [{ proposalId: 'B', rank: 3 }] }  // 1pt. Total B=4pts, 4votes
		];
		
		const tbResult = calculateBordaResults(tbBallots, tbChampionIds);
		expect(tbResult.rankedProposals[0].proposalId).toBe('B'); // B has more total votes
		expect(tbResult.rankedProposals[1].proposalId).toBe('A');
	});

	it('Single voter, single champion -> score = 1', () => {
		const championIds = ['c1'];
		const ballots: BallotResponse[] = [
			{ userId: 'u1', questionId: 'q1', isAbstention: false, ranks: [{ proposalId: 'c1', rank: 1 }] }
		];
		const result = calculateBordaResults(ballots, championIds);
		
		expect(result.rankedProposals[0].bordaScore).toBe(1);
	});

	it('0 ballots -> empty results', () => {
		const championIds = ['c1', 'c2'];
		const result = calculateBordaResults([], championIds);
		
		expect(result.totalBallots).toBe(0);
		expect(result.rankedProposals.length).toBe(2);
		expect(result.rankedProposals[0].bordaScore).toBe(0);
	});

	it('Ranks referencing non-champion IDs -> ignored', () => {
		const championIds = ['c1'];
		const ballots: BallotResponse[] = [
			{ userId: 'u1', questionId: 'q1', isAbstention: false, ranks: [{ proposalId: 'c1', rank: 1 }, { proposalId: 'c2', rank: 2 }] }
		];
		const result = calculateBordaResults(ballots, championIds);
		
		expect(result.rankedProposals.length).toBe(1);
		expect(result.rankedProposals[0].proposalId).toBe('c1');
	});
});
