import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSpeechTtsQueue } from './web-speech-tts-queue';

interface MockSpeechSynthesis {
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  getVoices: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  speaking: boolean;
  pending: boolean;
}

let mockSynth: MockSpeechSynthesis;
let utterances: { text: string; onend?: () => void; onerror?: (e: { error: string }) => void }[];

beforeEach(() => {
  utterances = [];
  mockSynth = {
    speak: vi.fn(
      (u: { text: string; onend?: () => void; onerror?: (e: { error: string }) => void }) => {
        utterances.push(u);
      },
    ),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getVoices: vi.fn(() => [{ name: 'Microsoft Hanh', lang: 'vi-VN' }]),
    addEventListener: vi.fn(),
    speaking: false,
    pending: false,
  };
  // @ts-expect-error mock global
  globalThis.speechSynthesis = mockSynth;
  // @ts-expect-error mock global
  globalThis.SpeechSynthesisUtterance = class {
    text: string;
    voice: unknown;
    lang = '';
    rate = 1;
    volume = 1;
    onend?: () => void;
    onerror?: (e: { error: string }) => void;
    constructor(text: string) {
      this.text = text;
    }
  };
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WebSpeechTtsQueue', () => {
  it('queues utterances up to MAX_QUEUE_DEPTH', () => {
    const q = new WebSpeechTtsQueue();
    q.speak('one');
    q.speak('two');
    expect(mockSynth.speak).toHaveBeenCalledTimes(2);
  });

  it('skips new arrival when queue is full (does NOT cancel — Chrome bug avoidance)', () => {
    const q = new WebSpeechTtsQueue();
    q.speak('one');
    q.speak('two');
    q.speak('three'); // queue full → skipped, NOT cancel-and-replace
    q.speak('four'); // still full → also skipped

    expect(mockSynth.speak).toHaveBeenCalledTimes(2);
    expect(mockSynth.cancel).not.toHaveBeenCalled();
    expect(utterances.map((u) => u.text)).toEqual(['one', 'two']);
  });

  it('accepts new utterances after queue drains via onend', () => {
    const q = new WebSpeechTtsQueue();
    q.speak('one');
    q.speak('two');
    q.speak('three'); // skipped

    // First utterance finishes
    utterances[0].onend?.();
    q.speak('four'); // queue has slot → accepted

    expect(mockSynth.speak).toHaveBeenCalledTimes(3);
    expect(utterances.map((u) => u.text)).toEqual(['one', 'two', 'four']);
  });

  it('dedups exact same text within 1500ms', () => {
    const q = new WebSpeechTtsQueue();
    q.speak('hello');
    q.speak('hello');
    expect(mockSynth.speak).toHaveBeenCalledTimes(1);
  });

  it('watchdog decrements pendingCount when onend never fires (Chrome silent-drop)', () => {
    const q = new WebSpeechTtsQueue();
    q.speak('one');
    q.speak('two');
    q.speak('three'); // queue full → skipped

    // Chrome silently drops the utterances — onend/onerror never invoked.
    // Without watchdog, queue is jammed forever. After UTTERANCE_TIMEOUT_MS the
    // watchdog must decrement so new arrivals can queue.
    vi.advanceTimersByTime(15_000);
    q.speak('four');
    expect(mockSynth.speak).toHaveBeenCalledTimes(3);
    expect(utterances.map((u) => u.text)).toEqual(['one', 'two', 'four']);
  });

  it('watchdog is cancelled by onend (no double-decrement)', () => {
    const q = new WebSpeechTtsQueue();
    q.speak('one');
    q.speak('two');

    // First utterance ends normally — pendingCount: 2 → 1.
    utterances[0].onend?.();
    q.speak('three'); // queue has slot → accepted
    expect(mockSynth.speak).toHaveBeenCalledTimes(3);

    // Watchdog for utterance 'one' fires after 15s. It should be cancelled
    // already → not decrement again. After advancing time, queue still
    // accepts only one new utterance (pendingCount went 2→3 from 'three').
    vi.advanceTimersByTime(15_000);
    // 'two' watchdog AND 'three' watchdog fire here → 2 decrements.
    // pendingCount: 3 → 1 (from those two), 'one' watchdog was cleared.
    q.speak('four');
    expect(mockSynth.speak).toHaveBeenCalledTimes(4);
  });

  it('cancel resets queue state — subsequent speak accepted immediately', () => {
    const q = new WebSpeechTtsQueue();
    q.speak('one');
    q.speak('two');
    expect(mockSynth.speak).toHaveBeenCalledTimes(2);

    q.cancel();
    expect(mockSynth.cancel).toHaveBeenCalled();

    // After cancel, pendingCount must be 0 → next speak accepted without
    // waiting on watchdog. If timers leaked, third speak would still be
    // blocked because old timer references would prevent re-queuing.
    q.speak('three');
    q.speak('four');
    expect(mockSynth.speak).toHaveBeenCalledTimes(4);
  });

  it('setMuted(true) cancels in-flight speech', () => {
    const q = new WebSpeechTtsQueue();
    q.setMuted(true);
    expect(mockSynth.cancel).toHaveBeenCalledTimes(1);
  });
});
