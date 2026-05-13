import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @polar-sh/sdk before importing PolarClient so the constructor picks up the mock
const mockCheckoutsCreate = vi.fn();

vi.mock('@polar-sh/sdk', () => ({
  Polar: vi.fn().mockImplementation(() => ({
    checkouts: { create: mockCheckoutsCreate },
  })),
}));

// Import AFTER mock is registered
const { PolarClient } = await import('../billing/polar-client.js');

function makeClient() {
  return new PolarClient({ apiKey: 'test_key', productIdPro: 'prod_123' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PolarClient.createCheckoutSession — host validation', () => {
  it('returns url when host is polar.sh', async () => {
    mockCheckoutsCreate.mockResolvedValue({ url: 'https://polar.sh/checkout/abc' });
    const result = await makeClient().createCheckoutSession({ userId: 'user_1' });
    expect(result.url).toBe('https://polar.sh/checkout/abc');
  });

  it('returns url when host is a polar.sh subdomain (sandbox.polar.sh)', async () => {
    mockCheckoutsCreate.mockResolvedValue({ url: 'https://sandbox.polar.sh/checkout/abc' });
    const result = await makeClient().createCheckoutSession({ userId: 'user_1' });
    expect(result.url).toBe('https://sandbox.polar.sh/checkout/abc');
  });

  it('throws when SDK returns an attacker URL', async () => {
    mockCheckoutsCreate.mockResolvedValue({ url: 'https://attacker.com/checkout?redirect=evil' });
    await expect(makeClient().createCheckoutSession({ userId: 'user_1' })).rejects.toThrow(
      /unexpected host/,
    );
  });

  it('throws when url is missing from session', async () => {
    mockCheckoutsCreate.mockResolvedValue({});
    await expect(makeClient().createCheckoutSession({ userId: 'user_1' })).rejects.toThrow(
      /missing url/,
    );
  });

  it('throws when host looks similar but is not polar.sh (typosquatting)', async () => {
    mockCheckoutsCreate.mockResolvedValue({ url: 'https://p0lar.sh/checkout/abc' });
    await expect(makeClient().createCheckoutSession({ userId: 'user_1' })).rejects.toThrow(
      /unexpected host/,
    );
  });
});
