import type { TranslateProvider } from './translate-provider-interface.js';

/**
 * TranslateProviderChain — composite TranslateProvider, tries each in order.
 * First success wins. Failures cascade to the next provider, so a Groq 429 or
 * a Gemini quota-exceeded no longer drops the chunk — pipeline stays alive
 * across single-provider throttles.
 *
 * Ordering matters: put the cheapest / lowest-latency provider first. Errors
 * from intermediate providers are logged at warn level so misbehaving keys
 * stay visible without flooding the user-facing error frame.
 */
export class TranslateProviderChain implements TranslateProvider {
  private readonly providers: ReadonlyArray<{ name: string; provider: TranslateProvider }>;

  constructor(providers: ReadonlyArray<{ name: string; provider: TranslateProvider }>) {
    if (providers.length === 0) {
      throw new Error('TranslateProviderChain: at least one provider is required');
    }
    this.providers = providers;
  }

  async translate(srcText: string, srcLang: string, targetLang: string): Promise<string> {
    let lastError: unknown;
    for (const { name, provider } of this.providers) {
      try {
        return await provider.translate(srcText, srcLang, targetLang);
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[translate-chain] ${name} failed: ${msg} — trying next provider`);
      }
    }
    throw lastError;
  }
}
