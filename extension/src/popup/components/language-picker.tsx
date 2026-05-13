import type { Settings } from '../../shared/settings-schema';

interface LanguagePickerProps {
  value: Settings['srcLanguage'];
  onChange: (lang: Settings['srcLanguage']) => void;
  disabled?: boolean;
}

const LANGUAGES: { value: Settings['srcLanguage']; label: string }[] = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'en',   label: 'English' },
  { value: 'ja',   label: 'Japanese' },
  { value: 'ko',   label: 'Korean' },
  { value: 'fr',   label: 'French' },
  { value: 'de',   label: 'German' },
];

export function LanguagePicker({ value, onChange, disabled = false }: LanguagePickerProps) {
  return (
    <div className="space-y-1">
      <label
        htmlFor="tv-language-picker"
        className="block text-xs font-medium text-gray-500 uppercase tracking-wide"
      >
        Source language
      </label>
      <select
        id="tv-language-picker"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as Settings['srcLanguage'])}
        className={[
          'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700',
          'focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
          'disabled:cursor-not-allowed disabled:opacity-50',
        ].join(' ')}
      >
        {LANGUAGES.map((lang) => (
          <option key={lang.value} value={lang.value}>
            {lang.label}
          </option>
        ))}
      </select>
    </div>
  );
}
