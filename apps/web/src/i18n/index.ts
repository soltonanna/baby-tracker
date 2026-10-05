import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, LOCALES, type Locale } from '@baby-tracker/shared';
import en from './locales/en.json';
import ru from './locales/ru.json';
import hy from './locales/hy.json';

const STORAGE_KEY = 'baby-tracker.locale';

/**
 * Each language's own name for itself, so a parent who landed in the wrong
 * language can still find theirs. Deliberately not translated.
 */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  ru: 'Русский',
  hy: 'Հայերեն',
};

export function isLocale(value: string | null | undefined): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

function initialLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) {
      return stored;
    }
  } catch {
    // Private browsing or blocked storage: fall through to the default.
  }
  const browser = window.navigator.language.slice(0, 2);
  return isLocale(browser) ? browser : DEFAULT_LOCALE;
}

/** Screen readers and the browser's hyphenation follow `<html lang>`. */
function syncDocumentLanguage(locale: string): void {
  document.documentElement.lang = locale;
}

i18n.on('languageChanged', syncDocumentLanguage);

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ru: { translation: ru },
    hy: { translation: hy },
  },
  lng: initialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  interpolation: { escapeValue: false },
});

export function currentLocale(): Locale {
  return isLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE;
}

export function setLocale(locale: Locale): void {
  void i18n.changeLanguage(locale);
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Preference simply will not persist; not worth surfacing.
  }
}

export default i18n;
