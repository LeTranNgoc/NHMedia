import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AzureTtsProvider } from '../azure-tts-provider.js';

describe('AzureTtsProvider', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: ReturnType<typeof vi.spyOn<any, any>>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(Buffer.from('fake-mp3-bytes'), {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg' },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('synthesize("Xin chào", vi/female) → returns non-empty Buffer with format mp3', async () => {
    const provider = new AzureTtsProvider({ apiKey: 'k', region: 'southeastasia' });

    const result = await provider.synthesize('Xin chào', { lang: 'vi', gender: 'female' });

    expect(result.audio).toBeInstanceOf(Buffer);
    expect(result.audio.length).toBeGreaterThan(0);
    expect(result.format).toBe('mp3');
  });

  it('builds correct endpoint URL using region', async () => {
    const provider = new AzureTtsProvider({ apiKey: 'k', region: 'westus' });

    await provider.synthesize('hello', { lang: 'en', gender: 'female' });

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('westus.tts.speech.microsoft.com');
    expect(url).toContain('cognitiveservices/v1');
  });

  it('sends Ocp-Apim-Subscription-Key header with apiKey', async () => {
    const provider = new AzureTtsProvider({ apiKey: 'secret-key', region: 'eastus' });

    await provider.synthesize('hi', { lang: 'en', gender: 'female' });

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Ocp-Apim-Subscription-Key']).toBe('secret-key');
  });

  it('body is SSML with voice name matching lang+gender', async () => {
    const provider = new AzureTtsProvider({ apiKey: 'k', region: 'eastus' });

    await provider.synthesize('Hello', { lang: 'hi', gender: 'female' });

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = init.body as string;
    expect(body).toContain('<speak');
    expect(body).toContain('<voice');
    expect(body).toMatch(/hi-IN-/);
    expect(body).toContain('Hello');
  });

  it('SSML escapes special characters in text (XSS-safe)', async () => {
    const provider = new AzureTtsProvider({ apiKey: 'k', region: 'eastus' });

    await provider.synthesize('A & B <tag>', { lang: 'en', gender: 'female' });

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = init.body as string;
    expect(body).toContain('&amp;');
    expect(body).toContain('&lt;');
    expect(body).not.toContain('<tag>');
  });

  it('401 response → throws auth error', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
    const provider = new AzureTtsProvider({ apiKey: 'bad', region: 'eastus' });

    await expect(
      provider.synthesize('hi', { lang: 'en', gender: 'female' }),
    ).rejects.toThrow(/401|auth|unauthorized/i);
  });

  it('unsupported lang → throws before fetch', async () => {
    const provider = new AzureTtsProvider({ apiKey: 'k', region: 'eastus' });

    await expect(
      provider.synthesize('hi', { lang: 'xx' as never, gender: 'female' }),
    ).rejects.toThrow(/unsupported|lang/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('constructor throws when apiKey is empty', () => {
    expect(() => new AzureTtsProvider({ apiKey: '', region: 'eastus' })).toThrow();
  });

  it('constructor throws when region is empty', () => {
    expect(() => new AzureTtsProvider({ apiKey: 'k', region: '' })).toThrow();
  });
});
