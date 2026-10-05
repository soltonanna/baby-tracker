import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setLocale } from '../../i18n/index.js';
import { SettingsPage } from './SettingsPage.js';
import { setThemePreference } from './theme.js';

afterEach(() => {
  setLocale('en');
  setThemePreference('system');
  window.localStorage.clear();
});

describe('SettingsPage', () => {
  it('switches the interface language at once and remembers it', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'Հայերեն' }));

    expect(screen.getByRole('heading', { name: 'Կարգավորումներ' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('hy');
    expect(window.localStorage.getItem('baby-tracker.locale')).toBe('hy');

    await user.click(screen.getByRole('radio', { name: 'Русский' }));
    expect(screen.getByRole('heading', { name: 'Настройки' })).toBeTruthy();
  });

  it('applies an explicit dark or light theme and remembers it', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    expect((screen.getByRole('radio', { name: 'System' }) as HTMLInputElement).checked).toBe(true);

    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('baby-tracker.theme')).toBe('dark');
    expect((screen.getByRole('radio', { name: 'Dark' }) as HTMLInputElement).checked).toBe(true);

    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
