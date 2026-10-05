import { useSyncExternalStore } from 'react';

/**
 * Light / dark appearance.
 *
 * The parent picks "system" (the default — follow the phone), "light" or
 * "dark". Whatever they pick is resolved to a concrete `light` or `dark` and
 * written to `<html data-theme>`; `styles/index.css` swaps the palette on that
 * attribute. Resolving in one place, rather than combining a media query with
 * an override in CSS, keeps a single copy of the dark palette.
 *
 * An inline script in `index.html` performs the same resolution before the
 * first paint, so a dark-mode parent at 3am never sees a white flash. The
 * storage key and the resolution rule here must match that script.
 */

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'baby-tracker.theme';

/** Browser chrome colour (status bar on phones): the canvas of each palette. */
const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: '#fbf8fd',
  dark: '#16131d',
};

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') {
    return systemPrefersDark ? 'dark' : 'light';
  }
  return preference;
}

function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(stored)) {
      return stored;
    }
  } catch {
    // Blocked storage: follow the system.
  }
  return 'system';
}

function darkMediaQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
}

let preference: ThemePreference | null = null;
const listeners = new Set<() => void>();

export function getThemePreference(): ThemePreference {
  preference ??= readStoredPreference();
  return preference;
}

function applyTheme(): void {
  const resolved = resolveTheme(getThemePreference(), darkMediaQuery()?.matches ?? false);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  // Native controls (time pickers, selects, scrollbars) follow this too.
  root.style.colorScheme = resolved;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    meta.content = THEME_COLOR[resolved];
  });
}

/** Call once at start-up: applies the theme and follows system changes. */
export function initTheme(): void {
  applyTheme();
  darkMediaQuery()?.addEventListener('change', () => {
    if (getThemePreference() === 'system') {
      applyTheme();
    }
  });
}

export function setThemePreference(next: ThemePreference): void {
  preference = next;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // The choice still applies for this visit; it just will not persist.
  }
  applyTheme();
  listeners.forEach((listener) => {
    listener();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, getThemePreference, getThemePreference);
}
