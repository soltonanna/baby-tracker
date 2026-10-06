import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setLocale } from '../../i18n/index.js';
import { PreferenceSwitchers } from './PreferenceControls.js';
import { setThemePreference } from './theme.js';

afterEach(() => {
  setLocale('en');
  setThemePreference('system');
  window.localStorage.clear();
});

describe('PreferenceSwitchers', () => {
  it('switches the interface language at once and remembers it', async () => {
    const user = userEvent.setup();
    render(<PreferenceSwitchers />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'hy');

    // The switcher's own name is now Armenian, and the pill shows the new code.
    const select = screen.getByRole('combobox', { name: 'Լեզու' });
    expect((select as HTMLSelectElement).value).toBe('hy');
    expect(screen.getByText('HY')).toBeTruthy();
    expect(document.documentElement.lang).toBe('hy');
    expect(window.localStorage.getItem('baby-tracker.locale')).toBe('hy');

    await user.selectOptions(select, 'ru');
    expect(screen.getByRole('combobox', { name: 'Язык' })).toBeTruthy();
  });

  it('applies an explicit dark or light theme and remembers it', async () => {
    const user = userEvent.setup();
    const { container } = render(<PreferenceSwitchers />);
    const theme = screen.getByRole('combobox', { name: 'Appearance' });

    expect((theme as HTMLSelectElement).value).toBe('system');
    expect(container.querySelector('[data-icon="auto-theme"]')).not.toBeNull();

    await user.selectOptions(theme, 'dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('baby-tracker.theme')).toBe('dark');
    expect(container.querySelector('[data-icon="moon"]')).not.toBeNull();

    await user.selectOptions(theme, 'light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
