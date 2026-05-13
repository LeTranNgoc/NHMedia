import { describe, it, expect } from 'vitest';
import { parseFrame, ParsedFrame } from '../audio-protocol.js';

describe('parseFrame — binary', () => {
  it('returns kind:audio for a Buffer', () => {
    const buf = Buffer.alloc(3200);
    const result = parseFrame(buf) as Extract<ParsedFrame, { kind: 'audio' }>;
    expect(result.kind).toBe('audio');
    expect(result.pcm).toBe(buf);
  });

  it('returns kind:audio for ArrayBuffer', () => {
    const ab = new ArrayBuffer(3200);
    const result = parseFrame(ab) as Extract<ParsedFrame, { kind: 'audio' }>;
    expect(result.kind).toBe('audio');
    expect(result.pcm).toBeInstanceOf(Buffer);
    expect(result.pcm.byteLength).toBe(3200);
  });
});

describe('parseFrame — text/control', () => {
  it('returns kind:control for valid config frame', () => {
    const json = JSON.stringify({ type: 'config', srcLang: 'en', audioMode: 'voice-over' });
    const result = parseFrame(json) as Extract<ParsedFrame, { kind: 'control' }>;
    expect(result.kind).toBe('control');
    expect(result.frame.type).toBe('config');
    if (result.frame.type === 'config') {
      expect(result.frame.srcLang).toBe('en');
      expect(result.frame.audioMode).toBe('voice-over');
    }
  });

  it('returns kind:control for pause frame', () => {
    const json = JSON.stringify({ type: 'pause' });
    const result = parseFrame(json) as Extract<ParsedFrame, { kind: 'control' }>;
    expect(result.kind).toBe('control');
    expect(result.frame.type).toBe('pause');
  });

  it('returns kind:control for resume frame', () => {
    const json = JSON.stringify({ type: 'resume' });
    const result = parseFrame(json) as Extract<ParsedFrame, { kind: 'control' }>;
    expect(result.kind).toBe('control');
    expect(result.frame.type).toBe('resume');
  });

  it('returns kind:control for flush frame', () => {
    const json = JSON.stringify({ type: 'flush' });
    const result = parseFrame(json) as Extract<ParsedFrame, { kind: 'control' }>;
    expect(result.kind).toBe('control');
    expect(result.frame.type).toBe('flush');
  });

  it('throws on invalid JSON string', () => {
    expect(() => parseFrame('not valid json {')).toThrow();
  });

  it('throws on JSON with unknown type', () => {
    const json = JSON.stringify({ type: 'unknown_type' });
    expect(() => parseFrame(json)).toThrow();
  });

  it('accepts config frame with non-allowlist srcLang (allowlist enforced by relay, not parser)', () => {
    // parser accepts any non-empty string; relay sends invalid_src_lang error
    const json = JSON.stringify({ type: 'config', srcLang: 'zh', audioMode: 'voice-over' });
    const result = parseFrame(json) as Extract<ParsedFrame, { kind: 'control' }>;
    expect(result.kind).toBe('control');
    expect(result.frame.type).toBe('config');
  });

  it('throws on config frame with missing srcLang', () => {
    const json = JSON.stringify({ type: 'config', audioMode: 'voice-over' });
    expect(() => parseFrame(json)).toThrow();
  });
});
