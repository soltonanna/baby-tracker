import type { ChangeEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Locale } from '@baby-tracker/shared';
import { LOCALES } from '@baby-tracker/shared';
import {
  AutoThemeIcon,
  ChevronDownIcon,
  MoonIcon,
  SunIcon,
  type IconProps,
} from '../../components/ui/icons.js';
import { LOCALE_NAMES, currentLocale, isLocale, setLocale } from '../../i18n/index.js';
import {
  THEME_PREFERENCES,
  isThemePreference,
  setThemePreference,
  useThemePreference,
  type ThemePreference,
} from './theme.js';

/**
 * Small language and appearance switchers for the top of every screen.
 *
 * Each is a real `<select>` laid invisibly over a compact pill: the pill shows
 * only a short code or an icon, so it fits beside the title on a phone, while
 * tapping it opens the platform's own picker with the full names. Keyboard and
 * screen-reader behaviour is the browser's, and the select carries the
 * accessible name. A choice applies at once — there is no Save to forget.
 */

interface CompactSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** What the closed pill shows. */
  display: ReactNode;
  options: { value: string; label: string; lang?: string }[];
}

function CompactSelect({ label, value, onChange, display, options }: CompactSelectProps) {
  return (
    <div
      className={[
        'relative inline-flex min-h-touch items-center gap-1 rounded-full',
        'border border-line bg-surface px-3 text-sm font-semibold text-ink',
        'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
        'has-[:focus-visible]:outline-tone',
      ].join(' ')}
    >
      <span aria-hidden="true" className="flex items-center">
        {display}
      </span>
      <ChevronDownIcon className="h-3.5 w-3.5 text-muted" />
      <select
        aria-label={label}
        value={value}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
          onChange(event.target.value);
        }}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} lang={option.lang}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function LanguageSwitcher() {
  const { t } = useTranslation();
  // `useTranslation` re-renders this on a language change, so the current
  // locale read here stays in step.
  const locale = currentLocale();

  return (
    <CompactSelect
      label={t('settings.language')}
      value={locale}
      onChange={(value) => {
        if (isLocale(value)) {
          setLocale(value);
        }
      }}
      display={<span className="w-6 text-center">{locale.toUpperCase()}</span>}
      // Each language is named in itself, so a parent who landed in the wrong
      // one can still find theirs.
      options={LOCALES.map((value: Locale) => ({
        value,
        label: LOCALE_NAMES[value],
        lang: value,
      }))}
    />
  );
}

const THEME_ICON: Record<ThemePreference, (props: IconProps) => ReactNode> = {
  system: AutoThemeIcon,
  light: SunIcon,
  dark: MoonIcon,
};

export function ThemeSwitcher() {
  const { t } = useTranslation();
  const preference = useThemePreference();
  const CurrentIcon = THEME_ICON[preference];

  return (
    <CompactSelect
      label={t('settings.theme')}
      value={preference}
      onChange={(value) => {
        if (isThemePreference(value)) {
          setThemePreference(value);
        }
      }}
      display={<CurrentIcon className="h-5 w-5" />}
      options={THEME_PREFERENCES.map((value) => ({
        value,
        label: t(`settings.themes.${value}`),
      }))}
    />
  );
}

/** Both switchers side by side, as every screen's header shows them. */
export function PreferenceSwitchers({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`.trim()}>
      <LanguageSwitcher />
      <ThemeSwitcher />
    </div>
  );
}
