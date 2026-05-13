import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PipelineOrchestrator } from '../pipeline-orchestrator.js';
import type { TranslateProvider } from '../../providers/translate/translate-provider-interface.js';
import type { TTSProvider } from '../../providers/tts/tts-provider-interface.js';
import type { WebSocket } from '@fastify/websocket';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeSocket(): WebSocket & { sentFrames: unknown[] } {
  const sentFrames: unknown[] = [];
  return {
    OPEN: 1,
    readyState: 1,
    send: vi.fn((data: string) => {
      sentFrames.push(JSON.parse(data));
    }),
    sentFrames,
  } as unknown as WebSocket & { sentFrames: unknown[] };
}

function makeTranslateProvider(resolveWith = 'Xin chào'): TranslateProvider {
  return { translate: vi.fn().mockResolvedValue(resolveWith) };
}

function makeTtsProvider(audioBytes = 8): TTSProvider {
  return {
    synthesize: vi.fn().mockResolvedValue({
      audio: Buffer.alloc(audioBytes),
      format: 'mp3',
    }),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('PipelineOrchestrator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('mock E2E: transcript → translate → TTS → audio frame emitted', async () => {
    const socket = makeSocket();
    const translate = makeTranslateProvider('Xin chào thế giới');
    const tts = makeTtsProvider();

    const orch = new PipelineOrchestrator({
      socket,
      translateProvider: translate,
      ttsProvider: tts,
      srcLang: 'en',
    });

    orch.onTranscript({ text: 'Hello world', isFinal: true, ts: 0 });

    // Allow async pipeline to complete
    await vi.runAllTimersAsync();
    await Promise.resolve(); // flush microtasks
    await Promise.resolve();

    expect(translate.translate).toHaveBeenCalledWith('Hello world', 'en', 'vi');
    expect(tts.synthesize).toHaveBeenCalledOnce();

    const frames = socket.sentFrames as Array<{ type: string }>;
    expect(frames.some((f) => f.type === 'translation')).toBe(true);
    expect(frames.some((f) => f.type === 'audio')).toBe(true);
  });

  it('3 interims within 300ms + 1 final → orchestrator emits 1 translation + 1 audio (not 4)', async () => {
    const socket = makeSocket();
    const translate = makeTranslateProvider('Dịch rồi');
    const tts = makeTtsProvider();

    const orch = new PipelineOrchestrator({
      socket,
      translateProvider: translate,
      ttsProvider: tts,
      srcLang: 'en',
    });

    // 3 interims within debounce window
    orch.onTranscript({ text: 'hello', isFinal: false, ts: 0 });
    await vi.advanceTimersByTimeAsync(50);
    orch.onTranscript({ text: 'hello world', isFinal: false, ts: 50 });
    await vi.advanceTimersByTimeAsync(50);
    orch.onTranscript({ text: 'hello world today', isFinal: false, ts: 100 });
    await vi.advanceTimersByTimeAsync(50);

    // 1 final arrives — triggers immediate emit
    orch.onTranscript({ text: 'hello world today', isFinal: true, ts: 150 });

    await vi.runAllTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    const frames = socket.sentFrames as Array<{ type: string }>;
    const translationFrames = frames.filter((f) => f.type === 'translation');
    const audioFrames = frames.filter((f) => f.type === 'audio');

    // Should emit exactly 1 translation + 1 audio (deduplicated)
    expect(translationFrames.length).toBe(1);
    expect(audioFrames.length).toBe(1);
    expect(translate.translate).toHaveBeenCalledOnce();
  });

  it('translate fails → emits error frame + skips TTS', async () => {
    const socket = makeSocket();
    const translate: TranslateProvider = {
      translate: vi.fn().mockRejectedValue(new Error('API quota exceeded')),
    };
    const tts = makeTtsProvider();

    const orch = new PipelineOrchestrator({
      socket,
      translateProvider: translate,
      ttsProvider: tts,
      srcLang: 'en',
    });

    orch.onTranscript({ text: 'Hello', isFinal: true, ts: 0 });
    await vi.runAllTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    const frames = socket.sentFrames as Array<{ type: string; code?: string }>;
    expect(frames.some((f) => f.type === 'error' && f.code === 'translate_fail')).toBe(true);
    expect(tts.synthesize).not.toHaveBeenCalled();

    // No audio frame
    expect(frames.some((f) => f.type === 'audio')).toBe(false);
  });

  it('TTS fails → emits translation frame only, no audio frame', async () => {
    const socket = makeSocket();
    const translate = makeTranslateProvider('Xin chào');
    const tts: TTSProvider = {
      synthesize: vi.fn().mockRejectedValue(new Error('quota exceeded')),
    };

    const orch = new PipelineOrchestrator({
      socket,
      translateProvider: translate,
      ttsProvider: tts,
      srcLang: 'en',
    });

    orch.onTranscript({ text: 'Hello', isFinal: true, ts: 0 });
    await vi.runAllTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    const frames = socket.sentFrames as Array<{ type: string; code?: string }>;
    expect(frames.some((f) => f.type === 'translation')).toBe(true);
    expect(frames.some((f) => f.type === 'audio')).toBe(false);
    expect(frames.some((f) => f.type === 'error' && f.code === 'tts_fail')).toBe(true);
  });

  it('cache: same transcript chunk twice → 2nd round skips translate API call', async () => {
    const socket = makeSocket();
    const translate = makeTranslateProvider('Xin chào');
    const tts = makeTtsProvider();

    const orch = new PipelineOrchestrator({
      socket,
      translateProvider: translate,
      ttsProvider: tts,
      srcLang: 'en',
    });

    // First time — unique text, isFinal
    orch.onTranscript({ text: 'Hello world', isFinal: true, ts: 0 });
    await vi.runAllTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(translate.translate).toHaveBeenCalledOnce();
    expect(tts.synthesize).toHaveBeenCalledOnce();

    // Interleave a different text to reset debouncer's lastEmittedText
    orch.onTranscript({ text: 'Different phrase', isFinal: true, ts: 500 });
    await vi.runAllTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(translate.translate).toHaveBeenCalledTimes(2); // new phrase translated

    // Now send the original text again — translate cache should be hit
    orch.onTranscript({ text: 'Hello world', isFinal: true, ts: 1000 });
    await vi.runAllTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    // translate should NOT have been called a 3rd time — cache hit for 'Hello world'
    expect(translate.translate).toHaveBeenCalledTimes(2);
    // TTS called for each unique pipeline run
    expect(tts.synthesize).toHaveBeenCalledTimes(3);
  });

  it('empty transcript → no translate, no TTS, no frames', async () => {
    const socket = makeSocket();
    const translate = makeTranslateProvider();
    const tts = makeTtsProvider();

    const orch = new PipelineOrchestrator({
      socket,
      translateProvider: translate,
      ttsProvider: tts,
      srcLang: 'en',
    });

    orch.onTranscript({ text: '', isFinal: true, ts: 0 });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(translate.translate).not.toHaveBeenCalled();
    expect(tts.synthesize).not.toHaveBeenCalled();
    expect(socket.sentFrames).toHaveLength(0);
  });

  it('translate returns empty string → skips TTS, emits error frame', async () => {
    const socket = makeSocket();
    const translate = makeTranslateProvider(''); // empty translation
    const tts = makeTtsProvider();

    const orch = new PipelineOrchestrator({
      socket,
      translateProvider: translate,
      ttsProvider: tts,
      srcLang: 'en',
    });

    orch.onTranscript({ text: 'Hello', isFinal: true, ts: 0 });
    await vi.runAllTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    const frames = socket.sentFrames as Array<{ type: string; code?: string }>;
    expect(frames.some((f) => f.type === 'error' && f.code === 'translate_empty')).toBe(true);
    expect(tts.synthesize).not.toHaveBeenCalled();
  });

  it('audio frame contains base64 data and format=mp3', async () => {
    const socket = makeSocket();
    const translate = makeTranslateProvider('Xin chào');
    const tts = makeTtsProvider(16);

    const orch = new PipelineOrchestrator({
      socket,
      translateProvider: translate,
      ttsProvider: tts,
      srcLang: 'en',
    });

    orch.onTranscript({ text: 'Hello', isFinal: true, ts: 0 });
    await vi.runAllTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    const frames = socket.sentFrames as Array<{ type: string; data?: string; format?: string }>;
    const audioFrame = frames.find((f) => f.type === 'audio');
    expect(audioFrame).toBeDefined();
    expect(audioFrame?.format).toBe('mp3');
    expect(typeof audioFrame?.data).toBe('string');
    // Should be valid base64
    expect(() => Buffer.from(audioFrame!.data!, 'base64')).not.toThrow();
  });

  it('destroy() prevents further processing', async () => {
    const socket = makeSocket();
    const translate = makeTranslateProvider('Xin chào');
    const tts = makeTtsProvider();

    const orch = new PipelineOrchestrator({
      socket,
      translateProvider: translate,
      ttsProvider: tts,
      srcLang: 'en',
    });

    orch.destroy();
    orch.onTranscript({ text: 'Hello', isFinal: true, ts: 0 });

    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(translate.translate).not.toHaveBeenCalled();
    expect(socket.sentFrames).toHaveLength(0);
  });

  it('very long transcript (>200 chars) → chunked into multiple TTS calls', async () => {
    const socket = makeSocket();
    const translate = makeTranslateProvider('Bản dịch');
    const tts = makeTtsProvider();

    const orch = new PipelineOrchestrator({
      socket,
      translateProvider: translate,
      ttsProvider: tts,
      srcLang: 'en',
    });

    // Build a text that will produce multiple sentence chunks
    const longText =
      'This is the first sentence. This is the second sentence. ' +
      'This is the third sentence. This is the fourth sentence. ' +
      'This is the fifth sentence with some extra words to make it longer.';

    orch.onTranscript({ text: longText, isFinal: true, ts: 0 });
    await vi.runAllTimersAsync();
    // Allow all async pipeline stages to complete
    for (let i = 0; i < 10; i++) await Promise.resolve();

    // Multiple chunks → multiple translate + TTS calls
    expect(translate.translate).toHaveBeenCalledTimes(5);
    expect(tts.synthesize).toHaveBeenCalledTimes(5);
  });
});
