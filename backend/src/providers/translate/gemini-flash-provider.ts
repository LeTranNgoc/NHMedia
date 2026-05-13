import { GoogleGenerativeAI } from '@google/generative-ai';
import type { TranslateProvider } from './translate-provider-interface.js';

const TRANSLATE_TIMEOUT_MS = 3000;
const GEMINI_MODEL = 'gemini-2.0-flash';
const TEMPERATURE = 0.3;

export interface GeminiFlashProviderOptions {
  apiKey: string;
}

export class GeminiFlashProvider implements TranslateProvider {
  private readonly genAI: GoogleGenerativeAI;

  constructor(opts: GeminiFlashProviderOptions) {
    this.genAI = new GoogleGenerativeAI(opts.apiKey);
  }

  async translate(srcText: string, srcLang: string, targetLang: 'vi'): Promise<string> {
    if (!srcText.trim()) return '';

    const model = this.genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: { temperature: TEMPERATURE },
    });

    const systemPrompt = `Translate the following ${srcLang} text to Vietnamese. Preserve proper nouns and brand names. Output Vietnamese only, no explanation.`;
    const prompt = `${systemPrompt}\n\n${srcText}`;

    // Suppress unused variable warning — targetLang is part of the interface contract
    void targetLang;

    return new Promise<string>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('translate_timeout'));
      }, TRANSLATE_TIMEOUT_MS);

      model
        .generateContent(prompt)
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result.response.text().trim());
        })
        .catch((err: Error) => {
          clearTimeout(timeoutId);
          reject(err);
        });
    });
  }
}
