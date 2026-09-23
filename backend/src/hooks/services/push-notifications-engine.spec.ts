import { describe, expect, it, vi, beforeEach } from 'vitest';
import { join } from 'path';
import { handleProposalPublished, handlePhaseChange } from './push-notifications-engine.js';

const PB_HOOKS_DIR = join(__dirname, '..', '..', '..', 'pb_hooks');

describe('push-notifications-engine', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		(global as any).$filepath = { join: (...parts: string[]) => join(...parts) };
		(global as any).__hooks = PB_HOOKS_DIR;
	});

	it('exits early if record has no branch_parent', () => {
		const record = {
			id: 'prop1',
			get: (field: string) => (field === 'branch_parent' ? '' : null)
		};


		expect(() => handleProposalPublished(record)).not.toThrow();
	});

	it('handles proposal published with batch query deduplication', () => {
		const findRecordByIdMock = vi.fn().mockImplementation((col: string, id: string) => {
			if (col === 'proposals' && id === 'parent1') {
				return {
					id: 'parent1',
					get: (field: string) => {
						if (field === 'author') return 'author1';
						if (field === 'question') return 'q1';
						return null;
					},
					getString: (field: string) => (field === 'title' ? 'Parent Proposal' : '')
				};
			}
			if (col === 'users') {
				return {
					id: id,
					getString: (field: string) => (field === 'language' ? 'en' : '')
				};
			}
			return null;
		});

		const findRecordsByFilterMock = vi.fn().mockImplementation((col: string, filter: string) => {
			if (col === 'proposal_votes' && filter.includes('proposal = {:pid}')) {
				return [
					{ get: (f: string) => (f === 'user' ? 'voter1' : null) },
					{ get: (f: string) => (f === 'user' ? 'voter2' : null) }
				];
			}
			if (col === 'push_subscriptions') {
				return [
					{ get: (f: string) => (f === 'user' ? 'voter1' : null), getString: () => 'sub1' }
				];
			}
			if (col === 'push_notification_log') {
				return [];
			}
			return [];
		});

		const saveMock = vi.fn();
		const findCollectionByNameOrIdMock = vi.fn().mockReturnValue({});
		const sendMock = vi.fn().mockReturnValue({ statusCode: 200 });

		(global as any).$app = {
			findRecordById: findRecordByIdMock,
			findRecordsByFilter: findRecordsByFilterMock,
			findCollectionByNameOrId: findCollectionByNameOrIdMock,
			save: saveMock
		};

		(global as any).Record = vi.fn().mockImplementation(() => ({ set: vi.fn(), id: 'log1' }));
		(global as any).$os = { getenv: () => '' };
		(global as any).$http = { send: sendMock };

		const record = {
			id: 'remix1',
			get: (field: string) => {
				if (field === 'branch_parent') return 'parent1';
				if (field === 'author') return 'remixer1';
				return null;
			},
			getString: (field: string) => (field === 'title' ? 'Remix Proposal' : '')
		};

		handleProposalPublished(record);

		expect(findRecordsByFilterMock).toHaveBeenCalledWith(
			'proposal_votes',
			'proposal = {:pid} && vote > 0',
			'',
			10000,
			0,
			{ pid: 'parent1' }
		);
		expect(sendMock).toHaveBeenCalled();
	});

	it('handlePhaseChange reads current_phase_name (not phase)', () => {
		const getStringCalls: string[] = [];

		const record = {
			id: 'q1',
			get: (field: string) => {
				if (field === 'group') return 'g1';
				return null;
			},
			getString: (field: string) => {
				getStringCalls.push(field);
				if (field === 'current_phase_name') return 'Closing';
				if (field === 'title') return 'Test Question';
				return '';
			}
		};

		const findRecordsByFilterMock = vi.fn().mockImplementation((col: string) => {
			if (col === 'group_members') return [{ get: (f: string) => (f === 'user' ? 'u1' : null) }];
			if (col === 'users') return [{ id: 'u1', getString: () => 'en' }];
			if (col === 'push_subscriptions') return [];
			if (col === 'push_notification_log') return [];
			return [];
		});

		(global as any).$app = {
			findRecordById: vi.fn(),
			findRecordsByFilter: findRecordsByFilterMock,
			findCollectionByNameOrId: vi.fn().mockReturnValue({}),
			save: vi.fn()
		};
		(global as any).Record = vi.fn().mockImplementation(() => ({ set: vi.fn(), id: 'log1' }));
		(global as any).$os = { getenv: () => '' };
		(global as any).$http = { send: vi.fn().mockReturnValue({ statusCode: 200 }) };

		handlePhaseChange(record);

		// Verify it reads "current_phase_name", NOT "phase"
		expect(getStringCalls).toContain('current_phase_name');
		expect(getStringCalls).not.toContain('phase');
	});
});

