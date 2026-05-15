import type { TTSProvider, TtsVoiceOptions, TtsSynthesisResult } from './tts-provider-interface.js';

/**
 * TtsProviderChain — composite TTSProvider that tries each provider in order.
 * First success wins. If all fail, throws the last error.
 */
export class TtsProviderChain implements TTSProvider {
  private readonly providers: TTSProvider[];

  constructor(providers: TTSProvider[]) {
    if (providers.length === 0) {
      throw new Error('TtsProviderChain: at least one provider is required');
    }
    this.providers = providers;
  }

  async synthesize(text: string, voice: TtsVoiceOptions): Promise<TtsSynthesisResult> {
    let lastError: unknown;
    for (const provider of this.providers) {
      try {
        return await provider.synthesize(text, voice);
      } catch (err) {
        lastError = err;
        // continue to next provider
      }
    }
    throw lastError;
  }
}
