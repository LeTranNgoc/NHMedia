/**
 * SettingsStore — chrome.storage.sync wrapper with Zod validation.
 *
 * - getDefaultSettings()  : returns schema defaults
 * - loadSettings()        : reads + validates from storage
 * - updateSettings(patch) : validates merged result, persists
 * - useSettings()         : React hook — subscribes to storage.onChanged
 */

import { useState, useEffect, useCallback } from 'react';
import { settingsSchema } from './settings-schema';
import type { Settings } from './settings-schema';

/** Keys this module owns in chrome.storage.sync. Only these are read/written. */
const SETTINGS_KEYS = Object.keys(settingsSchema.shape) as (keyof Settings)[];

export function getDefaultSettings(): Settings {
  return settingsSchema.parse({});
}

/** Read settings from chrome.storage.sync, falling back to schema defaults. */
export async function loadSettings(): Promise<Settings> {
  // Read only known settings keys — avoids pulling in unrelated extension storage entries.
  const raw = await chrome.storage.sync.get(SETTINGS_KEYS as string[]);
  // parse() fills in any missing keys with defaults
  return settingsSchema.parse(raw ?? {});
}

/**
 * Persist a partial settings update.
 * Merges with current stored values, validates the full object, then writes.
 * Throws a ZodError if the merged result is invalid.
 */
export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const current = await loadSettings();
  const merged = { ...current, ...patch };
  // Validate merged object — throws ZodError if invalid
  const validated = settingsSchema.parse(merged);
  await chrome.storage.sync.set(validated as unknown as Record<string, unknown>);
}

// ── React hook ────────────────────────────────────────────────────────────────

export interface UseSettingsResult {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
}

/**
 * useSettings — loads settings on mount, re-renders on chrome.storage.onChanged.
 * Only reacts to 'sync' area changes.
 */
export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<Settings>(getDefaultSettings);

  useEffect(() => {
    let mounted = true;

    // Initial load
    loadSettings()
      .then((s) => { if (mounted) setSettings(s); })
      .catch((err) => console.error('[settings-store] initial load failed:', err));

    // Subscribe to storage changes
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'sync') return;
      // Rebuild full settings from changed keys
      setSettings((prev) => {
        const patch: Record<string, unknown> = {};
        for (const [key, change] of Object.entries(changes)) {
          patch[key] = change.newValue;
        }
        try {
          return settingsSchema.parse({ ...prev, ...patch });
        } catch {
          return prev; // invalid update — keep previous
        }
      });
    };

    chrome.storage.onChanged.addListener(listener);

    return () => {
      mounted = false;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  const update = useCallback(async (patch: Partial<Settings>) => {
    await updateSettings(patch);
  }, []);

  return { settings, updateSettings: update };
}
