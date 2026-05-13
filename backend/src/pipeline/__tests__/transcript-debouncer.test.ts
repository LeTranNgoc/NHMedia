import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TranscriptDebouncer } from '../transcript-debouncer.js';

describe('TranscriptDebouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('5 interims within 300ms → 1 emit after debounce window', async () => {
    const cb = vi.fn();
    const debouncer = new TranscriptDebouncer(cb);

    for (let i = 1; i <= 5; i++) {
      debouncer.push({ text: `hello ${i}`, isFinal: false, ts: i * 50 });
      await vi.advanceTimersByTimeAsync(50);
    }

    // Not emitted yet — debounce window still open
    expect(cb).not.toHaveBeenCalled();

    // Advance past debounce window
    await vi.advanceTimersByTimeAsync(300);
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

  it('new interim after debounce window schedules a new timer', async () => {
    const cb = vi.fn();
    const debouncer = new TranscriptDebouncer(cb);

    debouncer.push({ text: 'first', isFinal: true, ts: 0 });
    expect(cb).toHaveBeenCalledOnce();

    // New distinct text after prior emit
    debouncer.push({ text: 'second phrase', isFinal: false, ts: 500 });
    await vi.advanceTimersByTimeAsync(300);

    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith('second phrase');
  });
});
