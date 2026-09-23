import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	initializeServerAuth,
	clearServerAuth,
	refreshAuth,
	getAuthSetCookieHeader
} from './pb.server';
import PocketBase, { ClientResponseError } from 'pocketbase';

vi.mock('pocketbase', () => {
	const mockClear = vi.fn();
	const mockExportToCookie = vi.fn(() => 'mocked_cookie_string');
	const mockLoadFromCookie = vi.fn();
	const mockAuthRefresh = vi.fn();

	class MockPocketBase {
		authStore: any;
		collection: any;
		constructor() {
			this.authStore = {
				clear: mockClear,
				exportToCookie: mockExportToCookie,
				loadFromCookie: mockLoadFromCookie,
				get isValid() {
					return true;
				},
				get model() {
					return { id: 'user_123', email: 'test@remix.local' };
				}
			};
			this.collection = vi.fn(() => ({
				authRefresh: mockAuthRefresh
			}));
		}
	}

	// Add ClientResponseError constructor for instanceof checks
	class MockClientResponseError extends Error {
		status: number;
		constructor(status = 400) {
			super('ClientResponseError');
			this.status = status;
		}
	}

	return {
		default: MockPocketBase,
		ClientResponseError: MockClientResponseError
	};
});

describe('pb.server.ts auth functionality', () => {
	let mockPb: any;

	beforeEach(() => {
		vi.clearAllMocks();
		mockPb = new PocketBase('http://localhost:8090');
	});

	it('clearServerAuth calls pb.authStore.clear', () => {
		clearServerAuth(mockPb);
		expect(mockPb.authStore.clear).toHaveBeenCalledTimes(1);
	});

	it('getAuthSetCookieHeader calls exportToCookie with secure options', () => {
		const header = getAuthSetCookieHeader(mockPb);
		expect(header).toBe('mocked_cookie_string');
		expect(mockPb.authStore.exportToCookie).toHaveBeenCalledWith(
			expect.objectContaining({
				httpOnly: true,
				path: '/',
				sameSite: true
			})
		);
	});

	it('refreshAuth returns record on success', async () => {
		const mockRecord = { id: 'user_123' };
		mockPb.collection().authRefresh.mockResolvedValueOnce({ record: mockRecord });

		const result = await refreshAuth(mockPb);
		expect(result).toBe(mockRecord);
		expect(mockPb.collection).toHaveBeenCalledWith('users');
		expect(mockPb.authStore.clear).not.toHaveBeenCalled();
	});

	it('refreshAuth clears authStore on 401 error', async () => {
		const error401 = new ClientResponseError(401);
		mockPb.collection().authRefresh.mockRejectedValueOnce(error401);

		const result = await refreshAuth(mockPb);
		expect(result).toBeNull();
		expect(mockPb.authStore.clear).toHaveBeenCalledTimes(1);
	});

	it('refreshAuth does not clear authStore on transient network error', async () => {
		const networkError = new TypeError('fetch failed');
		mockPb.collection().authRefresh.mockRejectedValueOnce(networkError);

		const result = await refreshAuth(mockPb);
		expect(result).toEqual({ id: 'user_123', email: 'test@remix.local' });
		expect(mockPb.authStore.clear).not.toHaveBeenCalled();
	});
});
