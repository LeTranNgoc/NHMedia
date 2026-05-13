import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { getDefaultSettings, updateSettings, useSettings } from './settings-store';
import type { Settings } from './settings-schema';

// ── chrome.storage.sync mock ──────────────────────────────────────────────────

type StorageChangeCallback = (
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
) => void;

let storedData: Record<string, unknown> = {};
const onChangedListeners: StorageChangeCallback[] = [];

const mockStorage = {
  sync: {
    get: vi.fn(async (_keys: string | string[] | null) => ({ ...storedData })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      const oldData = { ...storedData };
      Object.assign(storedData, items);
      // Simulate onChanged firing
      const changes: Record<string, chrome.storage.StorageChange> = {};
      for (const key of Object.keys(items)) {
        changes[key] = {
          oldValue: oldData[key],
          newValue: items[key],
        };
      }
      onChangedListeners.forEach((cb) => cb(changes, 'sync'));
    }),
  },
  onChanged: {
    addListener: vi.fn((cb: StorageChangeCallback) => {
      onChangedListeners.push(cb);
    }),
    removeListener: vi.fn((cb: StorageChangeCallback) => {
      const idx = onChangedListeners.indexOf(cb);
      if (idx !== -1) onChangedListeners.splice(idx, 1);
    }),
  },
};

vi.stubGlobal('chrome', { storage: mockStorage });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getDefaultSettings', () => {
  it('returns valid default settings matching the schema', () => {
    const defaults = getDefaultSettings();
    expect(defaults.enabled).toBe(false);
    expect(defaults.audioMode).toBe('voice-over');
    expect(defaults.duckingPercent).toBe(30);
    expect(defaults.voiceGender).toBe('female');
    expect(defaults.srcLanguage).toBe('auto');
    expect(defaults.subtitle).toBe(true);
  });
});

describe('updateSettings', () => {
  beforeEach(() => {
    storedData = {};
    vi.mocked(mockStorage.sync.set).mockClear();
  });

  it('persists partial settings to chrome.storage.sync', async () => {
    await updateSettings({ duckingPercent: 50 });
    expect(mockStorage.sync.set).toHaveBeenCalledWith(
      expect.objectContaining({ duckingPercent: 50 }),
    );
  });

  it('merges with defaults — does not overwrite unrelated fields', async () => {
    storedData = { voiceGender: 'male' };
    await updateSettings({ duckingPercent: 60 });
    const call = vi.mocked(mockStorage.sync.set).mock.calls[0][0] as Settings;
    expect(call.voiceGender).toBe('male');
    expect(call.duckingPercent).toBe(60);
  });

  it('rejects invalid values (Zod validation)', async () => {
    await expect(
      updateSettings({ duckingPercent: 150 } as Partial<Settings>),
    ).rejects.toThrow();
  });
});

describe('useSettings hook', () => {
  beforeEach(() => {
    storedData = {};
    onChangedListeners.length = 0;
    vi.mocked(mockStorage.sync.get).mockClear();
    vi.mocked(mockStorage.sync.set).mockClear();
    vi.mocked(mockStorage.onChanged.addListener).mockClear();
  });

  it('returns default settings on initial render', async () => {
    mockStorage.sync.get.mockResolvedValueOnce({});

    const { result } = renderHook(() => useSettings());

    // Settle async load
    await act(async () => {});

    expect(result.current.settings.duckingPercent).toBe(30);
    expect(result.current.settings.subtitle).toBe(true);
  });

  it('loads stored settings from chrome.storage.sync', async () => {
    mockStorage.sync.get.mockResolvedValueOnce({ duckingPercent: 70, voiceGender: 'male' });

    const { result } = renderHook(() => useSettings());
    await act(async () => {});

    expect(result.current.settings.duckingPercent).toBe(70);
    expect(result.current.settings.voiceGender).toBe('male');
  });

  it('re-renders when storage.onChanged fires', async () => {
    mockStorage.sync.get.mockResolvedValueOnce({});

    const { result } = renderHook(() => useSettings());
    await act(async () => {});

    expect(result.current.settings.duckingPercent).toBe(30);

    // Simulate storage change from another context
    await act(async () => {
      onChangedListeners.forEach((cb) =>
        cb({ duckingPercent: { oldValue: 30, newValue: 80 } }, 'sync'),
      );
    });

    expect(result.current.settings.duckingPercent).toBe(80);
  });

  it('ignores changes from non-sync storage areas', async () => {
    mockStorage.sync.get.mockResolvedValueOnce({});

    const { result } = renderHook(() => useSettings());
    await act(async () => {});

    await act(async () => {
      onChangedListeners.forEach((cb) =>
        cb({ duckingPercent: { oldValue: 30, newValue: 99 } }, 'local'), // 'local' area
      );
    });

    // Should not update — only 'sync' area is relevant
    expect(result.current.settings.duckingPercent).toBe(30);
  });

  it('updateSettings from hook persists and triggers re-render', async () => {
    mockStorage.sync.get.mockResolvedValueOnce({});

    const { result } = renderHook(() => useSettings());
    await act(async () => {});

    await act(async () => {
      await result.current.updateSettings({ subtitle: false });
    });

    expect(result.current.settings.subtitle).toBe(false);
  });

  it('removes onChanged listener on unmount', async () => {
    mockStorage.sync.get.mockResolvedValueOnce({});

    const { unmount } = renderHook(() => useSettings());
    await act(async () => {});

    unmount();

    expect(mockStorage.onChanged.removeListener).toHaveBeenCalled();
  });
});
