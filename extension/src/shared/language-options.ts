import type { Settings } from './settings-schema';

export interface LangOption {
  code: string;
  label: string;
}

export const SOURCE_LANG_OPTIONS: LangOption[] = [
  { code: 'auto',    label: 'Auto-detect' },
  { code: 'en',      label: 'English' },
  { code: 'ja',      label: '日本語' },
  { code: 'ko',      label: '한국어' },
  { code: 'fr',      label: 'Français' },
  { code: 'de',      label: 'Deutsch' },
  { code: 'hi',      label: 'हिन्दी' },
  { code: 'zh-Hans', label: '中文（简体）' },
];

export const TARGET_LANG_OPTIONS: LangOption[] = [
  { code: 'vi',      label: 'Tiếng Việt' },
  { code: 'en',      label: 'English' },
  { code: 'ko',      label: '한국어' },
  { code: 'ja',      label: '日本語' },
  { code: 'fr',      label: 'Français' },
  { code: 'de',      label: 'Deutsch' },
  { code: 'hi',      label: 'हिन्दी' },
  { code: 'zh-Hans', label: '中文（简体）' },
];

/**
 * Return the display label for a language code.
 * mode='source' includes 'auto'; mode='target' does not.
 * Falls back to the code itself if not found.
 */
export function getLanguageLabel(
  code: Settings['srcLanguage'] | Settings['targetLanguage'],
  mode: 'source' | 'target',
): string {
  const list = mode === 'source' ? SOURCE_LANG_OPTIONS : TARGET_LANG_OPTIONS;
  return list.find((o) => o.code === code)?.label ?? code;
}
