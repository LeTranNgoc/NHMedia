import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Chrome API mock ──────────────────────────────────────────────────────────
const mockStorageGet = vi.fn();
const mockStorageSet = vi.fn().mockResolvedValue(undefined);
const mockStorageRemove = vi.fn().mockResolvedValue(undefined);
const mockLaunchWebAuthFlow = vi.fn();

vi.stubGlobal('chrome', {
  runtime: {
    id: 'testextensionid123',
  },
  storage: {
    local: {
      get: mockStorageGet,
      set: mockStorageSet,
      remove: mockStorageRemove,
    },
  },
  identity: {
    launchWebAuthFlow: mockLaunchWebAuthFlow,
  },
});

// ── Fetch mock ───────────────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  signInWithGoogle,
  requestMagicLink,
  signInWithToken,
  signOut,
  getStoredToken,
} from './auth-client';

function mockOkFetch(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function mockErrorFetch(status: number, body = 'Error') {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve({ error: body }),
    text: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  mockStorageGet.mockReset();
  mockStorageSet.mockReset();
  mockStorageRemove.mockReset();
  mockLaunchWebAuthFlow.mockReset();
});

// ── getStoredToken ────────────────────────────────────────────────────────────
describe('getStoredToken', () => {
  it('returns the stored JWT when present', async () => {
    mockStorageGet.mockResolvedValueOnce({ authToken: 'stored-jwt' });
    expect(await getStoredToken()).toBe('stored-jwt');
  });

  it('returns null when nothing stored', async () => {
    mockStorageGet.mockResolvedValueOnce({});
    expect(await getStoredToken()).toBeNull();
  });

  it('returns null on chrome.storage error', async () => {
    mockStorageGet.mockRejectedValueOnce(new Error('storage error'));
    expect(await getStoredToken()).toBeNull();
  });
});

// ── signOut ───────────────────────────────────────────────────────────────────
describe('signOut', () => {
  it('calls chrome.storage.local.remove with authToken', async () => {
    await signOut();
    expect(mockStorageRemove).toHaveBeenCalledWith('authToken');
  });
});

// ── signInWithGoogle ──────────────────────────────────────────────────────────
describe('signInWithGoogle', () => {
  it('launches WebAuthFlow with extension-start URL and stores returned token', async () => {
    const redirectUrl = 'https://testextensionid123.chromiumapp.org/?token=jwt-from-google';
    mockLaunchWebAuthFlow.mockResolvedValueOnce(redirectUrl);

    const token = await signInWithGoogle();

    expect(mockLaunchWebAuthFlow).toHaveBeenCalledWith({
      url: expect.stringContaining('/auth/google/extension-start'),
      interactive: true,
    });
    expect(mockLaunchWebAuthFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining('extension_id=testextensionid123'),
      }),
    );
    expect(mockStorageSet).toHaveBeenCalledWith({ authToken: 'jwt-from-google' });
    expect(token).toBe('jwt-from-google');
  });

  it('throws when launchWebAuthFlow rejects (user cancelled)', async () => {
    mockLaunchWebAuthFlow.mockRejectedValueOnce(new Error('User cancelled'));

    await expect(signInWithGoogle()).rejects.toThrow('cancelled or failed');
  });

  it('throws when redirect URL has no token param', async () => {
    mockLaunchWebAuthFlow.mockResolvedValueOnce(
      'https://testextensionid123.chromiumapp.org/?no_token=here',
    );

    await expect(signInWithGoogle()).rejects.toThrow('no token in redirect URL');
    expect(mockStorageSet).not.toHaveBeenCalled();
  });

  it('throws when redirect URL is undefined', async () => {
    mockLaunchWebAuthFlow.mockResolvedValueOnce(undefined);

    await expect(signInWithGoogle()).rejects.toThrow('no token in redirect URL');
  });
});

// ── requestMagicLink ──────────────────────────────────────────────────────────
describe('requestMagicLink', () => {
  it('POSTs email + extensionId to /auth/magic-link/request', async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') }),
    );

    await requestMagicLink('user@example.com');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/magic-link/request'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"email":"user@example.com"'),
      }),
    );
    // extensionId included in body
    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.stringContaining('"extensionId":"testextensionid123"'),
      }),
    );
  });

  it('throws on 429 rate-limit response', async () => {
    mockFetch.mockReturnValueOnce(mockErrorFetch(429, 'Too many requests'));

    await expect(requestMagicLink('user@example.com')).rejects.toThrow('429');
  });

  it('throws on 403 extension not allowlisted', async () => {
    mockFetch.mockReturnValueOnce(mockErrorFetch(403, 'Extension ID not allowlisted'));

    await expect(requestMagicLink('user@example.com')).rejects.toThrow('403');
  });
});

// ── signInWithToken ───────────────────────────────────────────────────────────
describe('signInWithToken', () => {
  it('validates token via /auth/me and stores it on success', async () => {
    mockFetch.mockReturnValueOnce(
      mockOkFetch({ user: { email: 'pasted@example.com', id: 'uid1' } }),
    );

    const email = await signInWithToken('valid-jwt-token');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/me'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer valid-jwt-token' }),
      }),
    );
    expect(mockStorageSet).toHaveBeenCalledWith({ authToken: 'valid-jwt-token' });
    expect(email).toBe('pasted@example.com');
  });

  it('throws on 401 (invalid token) and does NOT store', async () => {
    mockFetch.mockReturnValueOnce(mockErrorFetch(401, 'Unauthorized'));

    await expect(signInWithToken('bad-token')).rejects.toThrow('401');
    expect(mockStorageSet).not.toHaveBeenCalled();
  });

  it('throws on network error and does NOT store', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    await expect(signInWithToken('some-token')).rejects.toThrow('Network failure');
    expect(mockStorageSet).not.toHaveBeenCalled();
  });
});
