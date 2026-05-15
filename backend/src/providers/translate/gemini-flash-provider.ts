import { GoogleGenerativeAI } from '@google/generative-ai';
import type { TranslateProvider } from './translate-provider-interface.js';

const TRANSLATE_TIMEOUT_MS = 3000;
// gemini-2.5-flash-lite chosen over 2.0-flash: lower latency, free-tier quota
// available on standard AI Studio projects (2.0-flash often hits limit:0 unless
// billing-enabled). Quality is sufficient for short EN→VI translation segments.
const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const TEMPERATURE = 0.3;

export interface GeminiFlashProviderOptions {
  apiKey: string;
}

const TARGET_LANG_NAMES: Record<string, string> = {
  vi: 'Vietnamese',
  en: 'English',
  ko: 'Korean',
  ja: 'Japanese',
  fr: 'French',
  de: 'German',
  hi: 'Hindi',
  'zh-Hans': 'Chinese (Simplified)',
};

function targetLanguageName(code: string): string {
  return TARGET_LANG_NAMES[code] ?? code;
}

export class GeminiFlashProvider implements TranslateProvider {
  private readonly genAI: GoogleGenerativeAI;

  constructor(opts: GeminiFlashProviderOptions) {
    this.genAI = new GoogleGenerativeAI(opts.apiKey);
  }

  async translate(srcText: string, srcLang: string, targetLang: string): Promise<string> {
    if (!srcText.trim()) return '';

    const model = this.genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: { temperature: TEMPERATURE },
    });

    const langName = targetLanguageName(targetLang);
    const systemPrompt = `Translate the following ${srcLang} text to ${langName}. Preserve proper nouns and brand names. Output ${langName} only, no explanation.`;
    const prompt = `${systemPrompt}\n\n${srcText}`;

    // Free tier hits 429 at 15 RPM. One retry after parsed retryDelay (or 2s fallback)
    // recovers from minor bursts without bubbling translate_fail to the client.
    // Second 429 → bubble up so caller surfaces to user.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this._callOnce(model, prompt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === 0 && msg.includes('429')) {
          const retryMs = this._parseRetryDelayMs(msg) ?? 2000;
          await new Promise((r) => setTimeout(r, retryMs));
          continue;
        }
        throw err;
      }
    }
    throw new Error('translate_unreachable');
  }

  private _callOnce(model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>, prompt: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error('translate_timeout')), TRANSLATE_TIMEOUT_MS);
      model.generateContent(prompt)
        .then((result) => { clearTimeout(timeoutId); resolve(result.response.text().trim()); })
        .catch((err: Error) => { clearTimeout(timeoutId); reject(err); });
    });
  }

  private _parseRetryDelayMs(errMsg: string): number | null {
    // Gemini 429 body includes "Please retry in 40.5s" or RetryInfo.retryDelay "40s"
    const match = errMsg.match(/retry in (\d+(?:\.\d+)?)s/i) ?? errMsg.match(/retryDelay["\s:]+(\d+(?:\.\d+)?)s/i);
    if (match === null) return null;
    return Math.ceil(parseFloat(match[1]) * 1000);
  }
}
