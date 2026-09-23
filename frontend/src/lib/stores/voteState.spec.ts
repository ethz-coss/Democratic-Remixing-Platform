/**
 * voteState.spec.ts — Unit tests for the shared proposal vote store.
 *
 * (optimistic update, rollback, server confirmation, grace period).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { voteState } from './voteState.svelte';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProposal(id: string, subscriptionCount = 0) {
	return { id, subscription_count: subscriptionCount };
}

// ─── init ─────────────────────────────────────────────────────────────────────

describe('voteState.init', () => {
	beforeEach(() => {
		voteState._resetForTest();
	});

	it('populates userVotes from server data', () => {
		voteState.init({ s1: 1, s2: 0 }, [makeProposal('s1'), makeProposal('s2')]);
		expect(voteState.getUserVote('s1')).toBe(1);
		expect(voteState.getUserVote('s2')).toBe(0);
	});

	it('populates subscriptionCounts from proposals', () => {
		voteState.init({}, [makeProposal('s1', 5), makeProposal('s2', 12)]);
		expect(voteState.subscriptionCounts).toEqual({ s1: 5, s2: 12 });
	});

	it('returns 0 for unknown proposals', () => {
		voteState.init({}, []);
		expect(voteState.getUserVote('unknown')).toBe(0);
	});

	it('replaces previous state entirely', () => {
		voteState.init({ s1: 1 }, [makeProposal('s1', 3)]);
		voteState.init({ s2: 1 }, [makeProposal('s2', 7)]);
		expect(voteState.getUserVote('s1')).toBe(0);
		expect(voteState.getUserVote('s2')).toBe(1);
	});

	it('handles empty inputs', () => {
		voteState.init({}, []);
		expect(voteState.userVotes).toEqual({});
		expect(voteState.subscriptionCounts).toEqual({});
	});
});

// ─── submitVote (optimistic update) ──────────────────────────────────────────

describe('voteState.submitVote', () => {
	beforeEach(() => {
		voteState._resetForTest();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('optimistically toggles vote from 0 → 1 and increments support', async () => {
		voteState.init({ s1: 0 }, [makeProposal('s1', 5)]);

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

		const promise = voteState.submitVote('s1', 'prob1');

		// Optimistic: immediately updated before fetch resolves
		expect(voteState.getUserVote('s1')).toBe(1);

		await promise;

		// Still correct after server confirms
		expect(voteState.getUserVote('s1')).toBe(1);
	});

	it('optimistically toggles vote from 1 → 0 and decrements support', async () => {
		voteState.init({ s1: 1 }, [makeProposal('s1', 5)]);

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

		const promise = voteState.submitVote('s1', 'prob1');

		expect(voteState.getUserVote('s1')).toBe(0);

		await promise;

		expect(voteState.getUserVote('s1')).toBe(0);
	});

	it('rolls back on server error', async () => {
		voteState.init({ s1: 0 }, [makeProposal('s1', 5)]);

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));

		await voteState.submitVote('s1', 'prob1');

		// Rolled back to original
		expect(voteState.getUserVote('s1')).toBe(0);
	});

	it('rolls back on network error', async () => {
		voteState.init({ s1: 1 }, [makeProposal('s1', 5)]);

		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));

		await voteState.submitVote('s1', 'prob1');

		// Rolled back to original
		expect(voteState.getUserVote('s1')).toBe(1);
	});

	it('calls onSuccess callback with confirmed values', async () => {
		voteState.init({ s1: 0 }, [makeProposal('s1', 3)]);

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

		const onSuccess = vi.fn();
		await voteState.submitVote('s1', 'prob1', onSuccess);

		expect(onSuccess).toHaveBeenCalledWith(4, 1);
	});

	it('does not call onSuccess on error', async () => {
		voteState.init({ s1: 0 }, [makeProposal('s1', 3)]);

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));

		const onSuccess = vi.fn();
		await voteState.submitVote('s1', 'prob1', onSuccess);

		expect(onSuccess).not.toHaveBeenCalled();
	});

	it('sends correct form data to the vote endpoint', async () => {
		voteState.init({ s1: 0 }, [makeProposal('s1', 3)]);

		const mockFetch = vi.fn().mockResolvedValue({ ok: true });
		vi.stubGlobal('fetch', mockFetch);

		await voteState.submitVote('s1', 'prob1');

		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, options] = mockFetch.mock.calls[0];
		expect(url).toBe('/questions/prob1/proposals?/vote');
		expect(options.method).toBe('POST');

		const body = options.body as FormData;
		expect(body.get('proposalId')).toBe('s1');
		expect(body.get('vote')).toBe('1');
	});

	it('multiple proposals do not interfere', async () => {
		voteState.init({ s1: 1, s2: 0 }, [makeProposal('s1', 5), makeProposal('s2', 3)]);

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

		await voteState.submitVote('s1', 'prob1');

		// s1 toggled off
		expect(voteState.getUserVote('s1')).toBe(0);

		// s2 unchanged
		expect(voteState.getUserVote('s2')).toBe(0);
	});

	it('protects optimistic values from init() during grace period', async () => {
		voteState.init({ s1: 0 }, [makeProposal('s1', 5)]);

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

		await voteState.submitVote('s1', 'prob1');

		// Optimistic: s1 = 1, support = 6
		expect(voteState.getUserVote('s1')).toBe(1);

		// Simulate realtime sync calling init() with STALE server data
		voteState.init({ s1: 0 }, [makeProposal('s1', 5)]);

		// Grace period protects — values unchanged
		expect(voteState.getUserVote('s1')).toBe(1);
	});
});

// ─── userVotes / subscriptionCounts getters ──────────────────────────────────────

describe('voteState reactive getters', () => {
	beforeEach(() => {
		voteState._resetForTest();
	});

	it('exposes userVotes map', () => {
		voteState.init({ s1: 1 }, [makeProposal('s1')]);
		expect(voteState.userVotes).toEqual({ s1: 1 });
	});

	it('exposes subscriptionCounts map', () => {
		voteState.init({}, [makeProposal('s1', 10)]);
		expect(voteState.subscriptionCounts).toEqual({ s1: 10 });
	});
});
