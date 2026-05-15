import type { TranslateProvider } from './translate-provider-interface.js';

const AZURE_ENDPOINT = 'https://api.cognitive.microsofttranslator.com/translate';
const API_VERSION = '3.0';

export interface AzureTranslateProviderOptions {
  apiKey: string;
}

export class AzureTranslateProvider implements TranslateProvider {
  private readonly apiKey: string;

  constructor(opts: AzureTranslateProviderOptions) {
    if (!opts.apiKey) {
      throw new Error('AzureTranslateProvider: apiKey is required');
    }
    this.apiKey = opts.apiKey;
  }

  async translate(srcText: string, srcLang: string, targetLang: string): Promise<string> {
    if (!srcText.trim()) return '';

    const params = new URLSearchParams({ 'api-version': API_VERSION, to: targetLang });
    if (srcLang && srcLang !== 'auto') {
      params.set('from', srcLang);
    }

    const url = `${AZURE_ENDPOINT}?${params.toString()}`;

    const response = await globalThis.fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ text: srcText }]),
    });

    if (response.status === 403) {
      throw new Error(`Azure Translator: quota exceeded or unauthorized (403)`);
    }

    if (response.status === 429) {
      throw new Error(`Azure Translator: rate limit exceeded (429)`);
    }

    if (!response.ok) {
      throw new Error(`Azure Translator: request failed with status ${response.status}`);
    }

    const data = (await response.json()) as Array<{
      translations: Array<{ text: string; to: string }>;
    }>;

    return data[0].translations[0].text;
  }
}
