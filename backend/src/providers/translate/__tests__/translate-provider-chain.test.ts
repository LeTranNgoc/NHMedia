import { describe, it, expect, vi } from 'vitest';
import { TranslateProviderChain } from '../translate-provider-chain.js';
import type { TranslateProvider } from '../translate-provider-interface.js';

function makeProvider(behavior: 'ok' | 'fail', name: string): TranslateProvider {
  return {
    translate: vi
      .fn()
      .mockImplementation(async () =>
        behavior === 'ok' ? `${name}-output` : Promise.reject(new Error(`${name} failed`)),
      ),
  };
}

describe('TranslateProviderChain', () => {
  it('throws when constructed with zero providers', () => {
    expect(() => new TranslateProviderChain([])).toThrow(/at least one provider/);
  });

  it('returns the first providers result when it succeeds', async () => {
    const a = makeProvider('ok', 'A');
    const b = makeProvider('ok', 'B');
    const chain = new TranslateProviderChain([
      { name: 'A', provider: a },
      { name: 'B', provider: b },
    ]);

    const out = await chain.translate('hello', 'en', 'vi');
    expect(out).toBe('A-output');
    expect(a.translate).toHaveBeenCalledOnce();
    expect(b.translate).not.toHaveBeenCalled();
  });

  it('cascades to the next provider when the first fails', async () => {
    const a = makeProvider('fail', 'A');
    const b = makeProvider('ok', 'B');
    const chain = new TranslateProviderChain([
      { name: 'A', provider: a },
      { name: 'B', provider: b },
    ]);

    const out = await chain.translate('hello', 'en', 'vi');
    expect(out).toBe('B-output');
    expect(a.translate).toHaveBeenCalledOnce();
    expect(b.translate).toHaveBeenCalledOnce();
  });

  it('throws the last error when all providers fail', async () => {
    const a = makeProvider('fail', 'A');
    const b = makeProvider('fail', 'B');
    const chain = new TranslateProviderChain([
      { name: 'A', provider: a },
      { name: 'B', provider: b },
    ]);

    await expect(chain.translate('hello', 'en', 'vi')).rejects.toThrow(/B failed/);
  });

  it('passes srcLang and targetLang through to the provider', async () => {
    const a = makeProvider('ok', 'A');
    const chain = new TranslateProviderChain([{ name: 'A', provider: a }]);

    await chain.translate('xin chao', 'vi', 'en');
    expect(a.translate).toHaveBeenCalledWith('xin chao', 'vi', 'en');
  });
});
