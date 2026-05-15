import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { AzureTranslateProvider } from '../azure-translate-provider.js';

// Used as documentation reference — actual URL checked via fetchSpy.mock.calls
const _ENDPOINT_PREFIX = 'https://api.cognitive.microsofttranslator.com/translate';
void _ENDPOINT_PREFIX;

describe('AzureTranslateProvider', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: MockInstance<any>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            {
              detectedLanguage: { language: 'en', score: 1 },
              translations: [{ text: 'Xin chào', to: 'vi' }],
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('translate("Hello", "en", "vi") → returns translated string from response', async () => {
    const provider = new AzureTranslateProvider({ apiKey: 'test-key' });

    const result = await provider.translate('Hello', 'en', 'vi');

    expect(result).toBe('Xin chào');
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('omits from= param when srcLang is empty (auto-detect)', async () => {
    const provider = new AzureTranslateProvider({ apiKey: 'k' });

    await provider.translate('Bonjour', '', 'vi');

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('to=vi');
    expect(url).not.toContain('from=');
  });

  it('omits from= param when srcLang is "auto"', async () => {
    const provider = new AzureTranslateProvider({ apiKey: 'k' });

    await provider.translate('Bonjour', 'auto', 'vi');

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).not.toContain('from=');
  });

  it('includes from= param when srcLang is explicit', async () => {
    const provider = new AzureTranslateProvider({ apiKey: 'k' });

    await provider.translate('Hello', 'en', 'vi');

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('from=en');
    expect(url).toContain('to=vi');
  });

  it('sends Ocp-Apim-Subscription-Key header with constructor key', async () => {
    const provider = new AzureTranslateProvider({ apiKey: 'my-secret-key' });

    await provider.translate('Hi', 'en', 'vi');

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Ocp-Apim-Subscription-Key']).toBe('my-secret-key');
  });

  it('empty text → returns empty string without calling fetch', async () => {
    const provider = new AzureTranslateProvider({ apiKey: 'k' });

    const result = await provider.translate('', 'en', 'vi');

    expect(result).toBe('');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('whitespace-only text → returns empty string without calling fetch', async () => {
    const provider = new AzureTranslateProvider({ apiKey: 'k' });

    const result = await provider.translate('   \n  ', 'en', 'vi');

    expect(result).toBe('');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('403 response → throws error containing "quota"', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 403001, message: 'quota exceeded' } }), {
        status: 403,
      }),
    );
    const provider = new AzureTranslateProvider({ apiKey: 'k' });

    await expect(provider.translate('Hi', 'en', 'vi')).rejects.toThrow(/quota|403/i);
  });

  it('429 response → throws error containing "rate" or "429"', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 429000, message: 'too many' } }), {
        status: 429,
      }),
    );
    const provider = new AzureTranslateProvider({ apiKey: 'k' });

    await expect(provider.translate('Hi', 'en', 'vi')).rejects.toThrow(/429|rate/i);
  });

  it('POST request body is JSON array with text field', async () => {
    const provider = new AzureTranslateProvider({ apiKey: 'k' });

    await provider.translate('Hello world', 'en', 'vi');

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string) as Array<{ text: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].text).toBe('Hello world');
  });

  it('constructor throws when apiKey is empty', () => {
    expect(() => new AzureTranslateProvider({ apiKey: '' })).toThrow(/api ?key/i);
  });

  it('translate to Hindi (hi) → uses to=hi in URL', async () => {
    const provider = new AzureTranslateProvider({ apiKey: 'k' });

    await provider.translate('Hello', 'en', 'hi');

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('to=hi');
  });
});
