import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Chrome API mock ──────────────────────────────────────────────────────────
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({ authToken: 'test-jwt-token' }),
    },
  },
  tabs: {
    create: vi.fn().mockResolvedValue({ id: 1 }),
  },
});

// ── Fetch mock ───────────────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { getBillingMe, startCheckout, getUsageHistory } from './billing-api-client';

function mockOkResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function mockErrorResponse(status: number, body = 'Error') {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve({ error: body }),
    text: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.mocked(chrome.tabs.create).mockClear();
});

// ── getBillingMe ─────────────────────────────────────────────────────────────

describe('getBillingMe', () => {
  it('fetches /billing/me and returns parsed response', async () => {
    const mockResponse = {
      tier: 'free',
      usageToday: { secondsCaptured: 300, limitSeconds: 900, percentUsed: 33 },
    };
    mockFetch.mockReturnValueOnce(mockOkResponse(mockResponse));

    const result = await getBillingMe();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/billing/me'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-jwt-token' }),
      }),
    );
    expect(result.tier).toBe('free');
    expect(result.usageToday.secondsCaptured).toBe(300);
  });

  it('throws on 401 response', async () => {
    mockFetch.mockReturnValueOnce(mockErrorResponse(401, 'Unauthorized'));

    await expect(getBillingMe()).rejects.toThrow('401');
  });

  it('throws on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    await expect(getBillingMe()).rejects.toThrow('Network failure');
  });
});

// ── startCheckout ─────────────────────────────────────────────────────────────

describe('startCheckout', () => {
  it('POSTs to /billing/checkout and opens returned URL in new tab', async () => {
    mockFetch.mockReturnValueOnce(
      mockOkResponse({ url: 'https://polar.sh/checkout/abc123' }),
    );

    await startCheckout();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/billing/checkout'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://polar.sh/checkout/abc123',
    });
  });

  it('throws when checkout API returns 503', async () => {
    mockFetch.mockReturnValueOnce(mockErrorResponse(503, 'Service unavailable'));

    await expect(startCheckout()).rejects.toThrow('503');
  });

  // ── Critical 5: Polar URL trust ────────────────────────────────────────────

  it('accepts polar.sh subdomain checkout URL (sandbox)', async () => {
    mockFetch.mockReturnValueOnce(
      mockOkResponse({ url: 'https://sandbox.polar.sh/checkout/xyz' }),
    );

    await startCheckout();

    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://sandbox.polar.sh/checkout/xyz',
    });
  });

  it('throws and does NOT open tab for attacker URL returned by backend', async () => {
    mockFetch.mockReturnValueOnce(
      mockOkResponse({ url: 'https://attacker.com/steal-payment' }),
    );

    await expect(startCheckout()).rejects.toThrow('not trusted');
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('throws and does NOT open tab for http (non-https) polar URL', async () => {
    mockFetch.mockReturnValueOnce(
      mockOkResponse({ url: 'http://polar.sh/checkout/abc' }),
    );

    await expect(startCheckout()).rejects.toThrow('not trusted');
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('throws and does NOT open tab for malformed URL', async () => {
    mockFetch.mockReturnValueOnce(
      mockOkResponse({ url: 'not-a-url' }),
    );

    await expect(startCheckout()).rejects.toThrow();
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });
});

// ── getUsageHistory ───────────────────────────────────────────────────────────

describe('getUsageHistory', () => {
  it('fetches /billing/usage with days param and returns array', async () => {
    const mockHistory = [
      { date: '2026-05-13', secondsCaptured: 600, limitSeconds: 900, percentUsed: 67 },
      { date: '2026-05-12', secondsCaptured: 0, limitSeconds: 900, percentUsed: 0 },
    ];
    mockFetch.mockReturnValueOnce(mockOkResponse(mockHistory));

    const result = await getUsageHistory(7);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/billing/usage?days=7'),
      expect.anything(),
    );
    expect(result).toHaveLength(2);
    expect(result[0]!.secondsCaptured).toBe(600);
  });

  it('defaults to 7 days when no argument given', async () => {
    mockFetch.mockReturnValueOnce(mockOkResponse([]));

    await getUsageHistory();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('days=7'),
      expect.anything(),
    );
  });
});
