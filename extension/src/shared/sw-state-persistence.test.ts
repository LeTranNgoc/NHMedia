import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadSwState, saveSwState, clearSwState } from './sw-state-persistence';

const sessionStore = new Map<string, unknown>();

const mockSession = {
  get: vi.fn(async (key: string) => {
    const v = sessionStore.get(key);
    return v === undefined ? {} : { [key]: v };
  }),
  set: vi.fn(async (items: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(items)) sessionStore.set(k, v);
  }),
  remove: vi.fn(async (key: string) => {
    sessionStore.delete(key);
  }),
};

beforeEach(() => {
  sessionStore.clear();
  vi.clearAllMocks();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { session: mockSession },
  };
});

describe('sw-state-persistence', () => {
  it('loadSwState returns defaults when nothing persisted', async () => {
    const state = await loadSwState();
    expect(state).toEqual({ activeTabId: null, currentStatus: 'idle' });
  });

  it('saveSwState + loadSwState round-trips full state', async () => {
    await saveSwState({
      activeTabId: 42,
      currentStatus: 'capturing',
      detectedLang: 'en',
      ccSource: { lang: 'en', kind: 'standard' },
    });

    const restored = await loadSwState();
    expect(restored).toEqual({
      activeTabId: 42,
      currentStatus: 'capturing',
      detectedLang: 'en',
      ccSource: { lang: 'en', kind: 'standard' },
    });
  });

  it('loadSwState coerces missing optional fields', async () => {
    sessionStore.set('tv:sw-state', { activeTabId: 7, currentStatus: 'translating' });
    const state = await loadSwState();
    expect(state.detectedLang).toBeUndefined();
    expect(state.ccSource).toBeUndefined();
    expect(state.activeTabId).toBe(7);
  });

  it('clearSwState removes the key', async () => {
    await saveSwState({ activeTabId: 99, currentStatus: 'playing' });
    await clearSwState();
    const state = await loadSwState();
    expect(state).toEqual({ activeTabId: null, currentStatus: 'idle' });
  });

  it('falls back to defaults when chrome.storage.session is unavailable', async () => {
    (globalThis as unknown as { chrome: unknown }).chrome = { storage: {} };
    const state = await loadSwState();
    expect(state).toEqual({ activeTabId: null, currentStatus: 'idle' });
  });
});
