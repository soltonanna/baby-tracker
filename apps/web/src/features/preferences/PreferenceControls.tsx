import { useTranslation } from 'react-i18next';
import { LOCALES, type Locale } from '@baby-tracker/shared';
import { CheckIcon } from '../../components/ui/icons.js';
import { LOCALE_NAMES, currentLocale, setLocale } from '../../i18n/index.js';
import {
  THEME_PREFERENCES,
  setThemePreference,
  useThemePreference,
  type ThemePreference,
} from './theme.js';

/**
 * Language and appearance pickers.
 *
 * The same pill pattern as the nappy kinds and the "for whom" field: real
 * radios, visually hidden and driven by their labels, a full touch target each,
 * and a tick as well as a colour on the chosen one. Both choices apply at once
 * — there is no Save button to forget.
 */

interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  /** Language of the label itself, when it differs from the page's. */
  lang?: string;
}

interface ChoiceGroupProps<T extends string> {
  name: string;
  legend: string;
  options: ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

function ChoiceGroup<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
}: ChoiceGroupProps<T>) {
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 block text-sm font-medium text-ink">{legend}</legend>
      <div className="grid grid-cols-3 gap-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={[
                'flex min-h-touch cursor-pointer items-center justify-center gap-1 rounded-full',
                'border px-2 text-center text-sm font-medium',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
                'has-[:focus-visible]:outline-tone',
                selected
                  ? 'border-tone bg-tone-soft text-tone-ink'
                  : 'border-tone-line bg-surface text-tone-ink',
              ].join(' ')}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => {
                  onChange(option.value);
                }}
                className="sr-only"
              />
              <CheckIcon className={selected ? 'h-4 w-4 shrink-0' : 'h-4 w-4 shrink-0 opacity-0'} />
              <span className="min-w-0 truncate" lang={option.lang}>
                {option.label}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function LanguageChoice() {
  const { t } = useTranslation();
  // `useTranslation` re-renders this on a language change, so reading the
  // current locale here stays in step.
  const options = LOCALES.map((locale) => ({
    value: locale,
    label: LOCALE_NAMES[locale],
    lang: locale,
  }));

  return (
    <ChoiceGroup<Locale>
      name="language"
      legend={t('settings.language')}
      options={options}
      value={currentLocale()}
      onChange={setLocale}
    />
  );
}

export function ThemeChoice() {
  const { t } = useTranslation();
  const preference = useThemePreference();
  const options = THEME_PREFERENCES.map((value) => ({
    value,
    label: t(`settings.themes.${value}`),
  }));

  return (
    <ChoiceGroup<ThemePreference>
      name="theme"
      legend={t('settings.theme')}
      options={options}
      value={preference}
      onChange={setThemePreference}
    />
  );
}
