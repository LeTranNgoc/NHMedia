/**
 * Service-worker state persistence via chrome.storage.session.
 *
 * MV3 service workers terminate after ~30s idle. The MessageRouter's
 * in-memory state (activeTabId, currentStatus, ccSource…) gets wiped
 * each cycle, so popup.getStatus returns a stale "idle" right after
 * the SW wakes from sleep — even though the user had translation
 * running just before.
 *
 * `chrome.storage.session` is the right tier:
 *   - Survives SW restart
 *   - Wipes on browser restart (don't leak stale state across sessions)
 *   - Same-origin only, no remote sync
 *
 * If the offscreen document is gone after SW wake (it dies with the SW
 * for the same reasons), the caller should reset `currentStatus` to
 * `'idle'` so the popup UI is consistent with the actual pipeline state.
 */

import type { CcSourceInfo, PipelineStatusMsg } from './messaging-types';

const STORAGE_KEY = 'tv:sw-state' as const;

export interface PersistedSwState {
  activeTabId: number | null;
  currentStatus: PipelineStatusMsg['status'];
  detectedLang?: string;
  ccSource?: CcSourceInfo;
}

const DEFAULT: PersistedSwState = {
  activeTabId: null,
  currentStatus: 'idle',
};

/** Read the previously-persisted state. Returns defaults when nothing stored. */
export async function loadSwState(): Promise<PersistedSwState> {
  if (!isSessionStorageAvailable()) return DEFAULT;
  try {
    const raw = (await chrome.storage.session.get(STORAGE_KEY)) as Record<string, unknown>;
    const stored = raw[STORAGE_KEY] as PersistedSwState | undefined;
    if (!stored) return DEFAULT;
    // Defensive: coerce missing fields to defaults so a partial / older shape
    // doesn't trip the consumer.
    return {
      activeTabId: stored.activeTabId ?? null,
      currentStatus: stored.currentStatus ?? 'idle',
      detectedLang: stored.detectedLang,
      ccSource: stored.ccSource,
    };
  } catch {
    return DEFAULT;
  }
}

/** Write the full state (atomic-ish — chrome.storage performs a single object replace). */
export async function saveSwState(state: PersistedSwState): Promise<void> {
  if (!isSessionStorageAvailable()) return;
  try {
    await chrome.storage.session.set({ [STORAGE_KEY]: state });
  } catch {
    // Storage write failure is non-fatal — worst case, popup shows stale on next SW wake.
  }
}

/** Clear persisted state — call when the user explicitly stops capture. */
export async function clearSwState(): Promise<void> {
  if (!isSessionStorageAvailable()) return;
  try {
    await chrome.storage.session.remove(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function isSessionStorageAvailable(): boolean {
  // chrome.storage.session exists in Chrome 102+. Test environments (vitest,
  // jsdom) don't have it — fall back to the in-memory path.
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.storage !== 'undefined' &&
    typeof chrome.storage.session !== 'undefined'
  );
}
