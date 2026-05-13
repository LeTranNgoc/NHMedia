import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Chrome API mock ────────────────────────────────────────────────────────────

const mockStorageGet = vi.fn();
const mockSendMessage = vi.fn().mockResolvedValue(undefined);
const mockTabsSendMessage = vi.fn().mockResolvedValue(undefined);
const mockTabsGet = vi.fn().mockResolvedValue({ url: 'https://www.youtube.com/watch?v=abc' });
const mockTabCaptureGetMediaStreamId = vi.fn();

vi.stubGlobal('chrome', {
  storage: {
    local: { get: mockStorageGet },
  },
  runtime: {
    sendMessage: mockSendMessage,
    lastError: undefined,
  },
  tabs: {
    sendMessage: mockTabsSendMessage,
    get: mockTabsGet,
  },
  tabCapture: {
    getMediaStreamId: mockTabCaptureGetMediaStreamId,
  },
});

// ── OffscreenManager mock ─────────────────────────────────────────────────────

const mockEnsureCreated = vi.fn().mockResolvedValue(undefined);
const mockSendToOffscreen = vi.fn().mockResolvedValue(undefined);

vi.mock('./offscreen-manager', () => ({
  OffscreenManager: vi.fn().mockImplementation(() => ({
    ensureCreated: mockEnsureCreated,
    sendToOffscreen: mockSendToOffscreen,
  })),
}));

// ── TabCaptureHandler mock ────────────────────────────────────────────────────

const mockStartCapture = vi.fn().mockResolvedValue(undefined);
const mockStopCapture = vi.fn().mockResolvedValue(undefined);

vi.mock('./tab-capture-handler', () => ({
  TabCaptureHandler: vi.fn().mockImplementation(() => ({
    startCapture: mockStartCapture,
    stopCapture: mockStopCapture,
  })),
}));

// ── Settings mock ─────────────────────────────────────────────────────────────

vi.mock('../shared/settings-store', () => ({
  loadSettings: vi.fn().mockResolvedValue({ srcLanguage: 'en' }),
  updateSettings: vi.fn().mockResolvedValue(undefined),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { MessageRouter } from './message-router';
import { OffscreenManager } from './offscreen-manager';

function makeRouter(): MessageRouter {
  const offscreen = new OffscreenManager();
  return new MessageRouter(offscreen);
}

function makeSender(tabId?: number): chrome.runtime.MessageSender {
  return { tab: tabId != null ? { id: tabId } : undefined } as chrome.runtime.MessageSender;
}

// ── Critical 1: JWT plumbing ──────────────────────────────────────────────────

describe('MessageRouter — popup.start JWT plumbing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartCapture.mockResolvedValue(undefined);
  });

  it('responds auth_required when no authToken in storage', async () => {
    mockStorageGet.mockResolvedValueOnce({}); // no authToken
    const router = makeRouter();
    const sendResponse = vi.fn();

    router.handle({ type: 'popup.start', tabId: 1 }, makeSender(), sendResponse);
    // Wait for async block to complete
    await new Promise((r) => setTimeout(r, 0));

    expect(sendResponse).toHaveBeenCalledWith({ ok: false, code: 'auth_required' });
    expect(mockStartCapture).not.toHaveBeenCalled();
  });

  it('passes jwt from storage into startCapture config', async () => {
    mockStorageGet.mockResolvedValueOnce({ authToken: 'my-jwt-token' });
    const router = makeRouter();
    const sendResponse = vi.fn();

    router.handle({ type: 'popup.start', tabId: 1 }, makeSender(), sendResponse);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockStartCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ jwt: 'my-jwt-token' }),
      }),
    );
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  it('responds ok:true when authToken present and startCapture succeeds', async () => {
    mockStorageGet.mockResolvedValueOnce({ authToken: 'tok' });
    const router = makeRouter();
    const sendResponse = vi.fn();

    router.handle({ type: 'popup.start', tabId: 1 }, makeSender(), sendResponse);
    await new Promise((r) => setTimeout(r, 0));

    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });
});

// ── Critical 2: quota_exceeded forwarding ─────────────────────────────────────

describe('MessageRouter — pipeline.error quota_exceeded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits quota_exceeded runtime message when reason is quota_exceeded', () => {
    const router = makeRouter();
    router.handle({ type: 'pipeline.error', reason: 'quota_exceeded' }, makeSender(), vi.fn());

    expect(mockSendMessage).toHaveBeenCalledWith({ type: 'quota_exceeded' });
  });

  it('does NOT emit quota_exceeded for other error reasons', () => {
    const router = makeRouter();
    router.handle({ type: 'pipeline.error', reason: 'auth_failed' }, makeSender(), vi.fn());

    const quotaCalls = mockSendMessage.mock.calls.filter(
      (args) => args[0]?.type === 'quota_exceeded',
    );
    expect(quotaCalls).toHaveLength(0);
  });

  it('includes errorMessage reason in pipeline.status broadcast', () => {
    const router = makeRouter();
    router.handle({ type: 'pipeline.error', reason: 'quota_exceeded' }, makeSender(), vi.fn());

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'pipeline.status', errorMessage: 'quota_exceeded' }),
    );
  });
});

// ── Critical 3: content.startSession SW handler ───────────────────────────────

describe('MessageRouter — content.startSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartCapture.mockResolvedValue(undefined);
  });

  it('starts capture using sender.tab.id when authToken present', async () => {
    mockStorageGet.mockResolvedValueOnce({ authToken: 'tok' });
    const router = makeRouter();
    const sendResponse = vi.fn();

    router.handle({ type: 'content.startSession' }, makeSender(42), sendResponse);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockStartCapture).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 42 }),
    );
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  it('responds no_tab when sender has no tab', async () => {
    const router = makeRouter();
    const sendResponse = vi.fn();

    router.handle({ type: 'content.startSession' }, makeSender(), sendResponse);
    await new Promise((r) => setTimeout(r, 0));

    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'no_tab' });
    expect(mockStartCapture).not.toHaveBeenCalled();
  });

  it('responds auth_required when no authToken and sender has tab', async () => {
    mockStorageGet.mockResolvedValueOnce({}); // no authToken
    const router = makeRouter();
    const sendResponse = vi.fn();

    router.handle({ type: 'content.startSession' }, makeSender(99), sendResponse);
    await new Promise((r) => setTimeout(r, 0));

    expect(sendResponse).toHaveBeenCalledWith({ ok: false, code: 'auth_required' });
  });
});

// ── High 2: activeTabId cleared before badge broadcast ────────────────────────

describe('MessageRouter — pipeline.error badge broadcast ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends badge OFF to the tab even after activeTabId is nulled', async () => {
    // Seed an active session so activeTabId is set
    mockStorageGet.mockResolvedValueOnce({ authToken: 'tok' });
    const router = makeRouter();

    router.handle({ type: 'popup.start', tabId: 7 }, makeSender(), vi.fn());
    await new Promise((r) => setTimeout(r, 0));

    // Simulate pipeline error
    mockTabsSendMessage.mockClear();
    router.handle({ type: 'pipeline.error', reason: 'conn_closed' }, makeSender(), vi.fn());

    expect(mockTabsSendMessage).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: 'sw.status.badge', enabled: false }),
    );
  });
});
