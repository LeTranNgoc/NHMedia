/**
 * TranslateProvider — thin abstraction over translation backends.
 * GeminiFlashProvider is the sole implementation for MVP.
 * DeepL / LibreTranslate can swap in later without touching the pipeline layer.
 */
export interface TranslateProvider {
  translate(srcText: string, srcLang: string, targetLang: 'vi'): Promise<string>;
}
