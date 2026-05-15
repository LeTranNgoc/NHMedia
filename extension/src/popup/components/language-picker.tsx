import type { Settings } from '../../shared/settings-schema';
import { SOURCE_LANG_OPTIONS, TARGET_LANG_OPTIONS } from '../../shared/language-options';

type SrcLang = Settings['srcLanguage'];
type TgtLang = Settings['targetLanguage'];

interface LanguagePickerSourceProps {
  mode: 'source';
  value: SrcLang;
  onChange: (lang: SrcLang) => void;
  label?: string;
  disabled?: boolean;
}

interface LanguagePickerTargetProps {
  mode: 'target';
  value: TgtLang;
  onChange: (lang: TgtLang) => void;
  label?: string;
  disabled?: boolean;
}

type LanguagePickerProps = LanguagePickerSourceProps | LanguagePickerTargetProps;

const PICKER_ID_SOURCE = 'tv-language-picker-source';
const PICKER_ID_TARGET = 'tv-language-picker-target';

export function LanguagePicker(props: LanguagePickerProps) {
  const { mode, disabled = false, label } = props;

  const options = mode === 'source' ? SOURCE_LANG_OPTIONS : TARGET_LANG_OPTIONS;
  const id = mode === 'source' ? PICKER_ID_SOURCE : PICKER_ID_TARGET;
  const defaultLabel = mode === 'source' ? 'Source language' : 'Target language';

  return (
    <div className="space-y-1">
      <label
        htmlFor={id}
        className="block text-xs font-medium text-gray-500 uppercase tracking-wide"
      >
        {label ?? defaultLabel}
      </label>
      <select
        id={id}
        value={props.value}
        disabled={disabled}
        onChange={(e) => {
          if (mode === 'source') {
            (props as LanguagePickerSourceProps).onChange(e.target.value as SrcLang);
          } else {
            (props as LanguagePickerTargetProps).onChange(e.target.value as TgtLang);
          }
        }}
        className={[
          'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700',
          'focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
          'disabled:cursor-not-allowed disabled:opacity-50',
        ].join(' ')}
      >
        {options.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.label}
          </option>
        ))}
      </select>
    </div>
  );
}
