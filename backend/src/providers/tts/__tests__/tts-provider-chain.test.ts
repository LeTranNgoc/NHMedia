import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TtsProviderChain } from '../tts-provider-chain.js';
import type { TTSProvider, TtsSynthesisResult, TtsVoiceOptions } from '../tts-provider-interface.js';

function makeMockProvider(behavior: 'ok' | 'unsupported' | 'error', name: string): TTSProvider {
  const audio = Buffer.from(`${name}-audio-bytes`);
  return {
    synthesize: vi.fn(async (_text: string, _voice: TtsVoiceOptions): Promise<TtsSynthesisResult> => {
      if (behavior === 'unsupported') {
        const err = new Error(`unsupported lang in ${name}`);
        (err as Error & { code?: string }).code = 'UNSUPPORTED_LANG';
        throw err;
      }
      if (behavior === 'error') {
        throw new Error(`${name} failed`);
      }
      return { audio, format: 'mp3' };
    }),
  };
}

describe('TtsProviderChain', () => {
  let primary: TTSProvider;
  let fallback: TTSProvider;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('primary OK → returns primary audio, fallback not called', async () => {
    primary = makeMockProvider('ok', 'primary');
    fallback = makeMockProvider('ok', 'fallback');
    const chain = new TtsProviderChain([primary, fallback]);

    const result = await chain.synthesize('Hello', { lang: 'vi', gender: 'female' });

    expect(result.audio.toString()).toBe('primary-audio-bytes');
    expect(primary.synthesize).toHaveBeenCalledOnce();
    expect(fallback.synthesize).not.toHaveBeenCalled();
  });

  it('primary unsupported lang → fallback called, returns fallback audio', async () => {
    primary = makeMockProvider('unsupported', 'primary');
    fallback = makeMockProvider('ok', 'fallback');
    const chain = new TtsProviderChain([primary, fallback]);

    const result = await chain.synthesize('namaste', { lang: 'hi', gender: 'female' });

    expect(result.audio.toString()).toBe('fallback-audio-bytes');
    expect(primary.synthesize).toHaveBeenCalledOnce();
    expect(fallback.synthesize).toHaveBeenCalledOnce();
  });

  it('primary generic error → fallback called', async () => {
    primary = makeMockProvider('error', 'primary');
    fallback = makeMockProvider('ok', 'fallback');
    const chain = new TtsProviderChain([primary, fallback]);

    const result = await chain.synthesize('hi', { lang: 'vi', gender: 'female' });

    expect(result.audio.toString()).toBe('fallback-audio-bytes');
    expect(fallback.synthesize).toHaveBeenCalledOnce();
  });

  it('both providers fail → throws aggregated error', async () => {
    primary = makeMockProvider('unsupported', 'primary');
    fallback = makeMockProvider('error', 'fallback');
    const chain = new TtsProviderChain([primary, fallback]);

    await expect(
      chain.synthesize('hi', { lang: 'hi', gender: 'female' }),
    ).rejects.toThrow();
    expect(primary.synthesize).toHaveBeenCalledOnce();
    expect(fallback.synthesize).toHaveBeenCalledOnce();
  });

  it('empty providers array → throws on construction', () => {
    expect(() => new TtsProviderChain([])).toThrow();
  });

  it('single provider chain works like solo provider', async () => {
    primary = makeMockProvider('ok', 'only');
    const chain = new TtsProviderChain([primary]);

    const result = await chain.synthesize('hi', { lang: 'vi', gender: 'female' });

    expect(result.audio.toString()).toBe('only-audio-bytes');
  });
});
