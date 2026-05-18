import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TranscriptDebouncer } from '../transcript-debouncer.js';

describe('TranscriptDebouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rapid interims → debounce to a single emit of the latest text', async () => {
    const cb = vi.fn();
    const debouncer = new TranscriptDebouncer(cb);

    // Each interim resets the 400ms window — 5 emits within 250ms total never
    // fire the callback until the window finally elapses with the last text.
    for (let i = 1; i <= 5; i++) {
      debouncer.push({ text: `hello ${i}`, isFinal: false, ts: i * 50 });
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(cb).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(400);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith('hello 5');
  });

  it('interim, then isFinal within 100ms → emit on isFinal immediately', async () => {
    const cb = vi.fn();
    const debouncer = new TranscriptDebouncer(cb);

    debouncer.push({ text: 'good morning', isFinal: false, ts: 0 });
    await vi.advanceTimersByTimeAsync(100);

    // Still within debounce window
    expect(cb).not.toHaveBeenCalled();

    debouncer.push({ text: 'good morning world', isFinal: true, ts: 100 });

    // isFinal triggers immediate emit — no timer advance needed
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith('good morning world');
  });

  it('same interim twice → emit once', async () => {
    const cb = vi.fn();
    const debouncer = new TranscriptDebouncer(cb);

    debouncer.push({ text: 'hello', isFinal: true, ts: 0 });
    expect(cb).toHaveBeenCalledOnce();

    // Same text pushed again as interim
    debouncer.push({ text: 'hello', isFinal: false, ts: 100 });
    await vi.advanceTimersByTimeAsync(500);

    // Should NOT emit a second time — text is subset of last emitted
    expect(cb).toHaveBeenCalledOnce();
  });

  it('empty text → no emit', async () => {
    const cb = vi.fn();
    const debouncer = new TranscriptDebouncer(cb);

    debouncer.push({ text: '', isFinal: false, ts: 0 });
    debouncer.push({ text: '   ', isFinal: true, ts: 10 });
    await vi.advanceTimersByTimeAsync(500);

    expect(cb).not.toHaveBeenCalled();
  });

  it('flush cancels pending timer', async () => {
    const cb = vi.fn();
    const debouncer = new TranscriptDebouncer(cb);

    debouncer.push({ text: 'pending', isFinal: false, ts: 0 });
    debouncer.flush();

    await vi.advanceTimersByTimeAsync(500);
    expect(cb).not.toHaveBeenCalled();
  });

  it('interim after a final → emits via debounce window', async () => {
    const cb = vi.fn();
    const debouncer = new TranscriptDebouncer(cb);

    debouncer.push({ text: 'first', isFinal: true, ts: 0 });
    expect(cb).toHaveBeenCalledOnce();

    debouncer.push({ text: 'second phrase', isFinal: false, ts: 500 });
    await vi.advanceTimersByTimeAsync(400);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith('second phrase');

    // Delta-emit: "second phrase final" extends "second phrase" → emit only "final"
    debouncer.push({ text: 'second phrase final', isFinal: true, ts: 1500 });
    expect(cb).toHaveBeenCalledTimes(3);
    expect(cb).toHaveBeenLastCalledWith('final');
  });

  it('extension of prior emit → only the delta is emitted (avoids TTS repetition)', async () => {
    const cb = vi.fn();
    const debouncer = new TranscriptDebouncer(cb);

    debouncer.push({ text: 'Hello world.', isFinal: true, ts: 0 });
    expect(cb).toHaveBeenLastCalledWith('Hello world.');

    // Deepgram extends with same prefix + new content → emit only the new part.
    debouncer.push({ text: 'Hello world. This is a test.', isFinal: true, ts: 500 });
    expect(cb).toHaveBeenLastCalledWith('This is a test.');
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('exact duplicate text → no second emit', async () => {
    const cb = vi.fn();
    const debouncer = new TranscriptDebouncer(cb);

    debouncer.push({ text: 'Hello world.', isFinal: true, ts: 0 });
    expect(cb).toHaveBeenCalledOnce();

    debouncer.push({ text: 'Hello world.', isFinal: true, ts: 100 });
    expect(cb).toHaveBeenCalledOnce();
  });

  it('punctuation drift: interim "Hello world how are" → final "Hello, world, how are you?" → delta only', async () => {
    // Regression: with INTERIM_DEBOUNCE_MS>0, Deepgram emits punctuation-free
    // interims, then a smart_format final adds commas. Raw startsWith would
    // mismatch and re-emit the whole final → user hears the same sentence twice.
    const cb = vi.fn();
    const debouncer = new TranscriptDebouncer(cb);

    debouncer.push({ text: 'Hello world how are', isFinal: true, ts: 0 });
    expect(cb).toHaveBeenLastCalledWith('Hello world how are');

    debouncer.push({ text: 'Hello, world, how are you?', isFinal: true, ts: 500 });
    expect(cb).toHaveBeenLastCalledWith('you?');
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('punctuation-only extension: "Hello world" → "Hello, world." → drop duplicate', async () => {
    const cb = vi.fn();
    const debouncer = new TranscriptDebouncer(cb);

    debouncer.push({ text: 'Hello world', isFinal: true, ts: 0 });
    expect(cb).toHaveBeenCalledOnce();

    // Same words, just punctuation/casing — normalize equal → skip.
    debouncer.push({ text: 'Hello, world.', isFinal: true, ts: 500 });
    expect(cb).toHaveBeenCalledOnce();
  });

  it('final cancels a pending interim — only one emit, the final wins', async () => {
    const cb = vi.fn();
    const debouncer = new TranscriptDebouncer(cb);

    debouncer.push({ text: 'how are', isFinal: false, ts: 0 });
    await vi.advanceTimersByTimeAsync(100);
    // Within the 400ms window — final arrives before interim debounce fires
    debouncer.push({ text: 'how are you', isFinal: true, ts: 100 });

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith('how are you');

    // Advance past the original interim's debounce — pending was cleared,
    // no second emit should fire.
    await vi.advanceTimersByTimeAsync(500);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('new utterance whose text appears as substring of a previous final → must emit', async () => {
    // Regression: previously used `includes` which silently dropped any text
    // that was a substring of the last emitted — common short words like
    // "the", "is", "and" would never re-emit after the first long final.
    const cb = vi.fn();
    const debouncer = new TranscriptDebouncer(cb);

    debouncer.push({ text: 'Hello, world, this is a test.', isFinal: true, ts: 0 });
    expect(cb).toHaveBeenCalledOnce();

    // "world" is a substring of the prior final but is a NEW utterance — must emit.
    debouncer.push({ text: 'world', isFinal: true, ts: 1000 });
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith('world');
  });

  it('stale interim shorter than the just-emitted final → drop (prefix dedup)', async () => {
    const cb = vi.fn();
    const debouncer = new TranscriptDebouncer(cb);

    debouncer.push({ text: 'good morning world', isFinal: true, ts: 0 });
    expect(cb).toHaveBeenCalledOnce();

    // A late-arriving interim that's a prefix of the final → dedupe.
    debouncer.push({ text: 'good morning', isFinal: false, ts: 50 });
    await vi.advanceTimersByTimeAsync(500);
    expect(cb).toHaveBeenCalledOnce();
  });
});
