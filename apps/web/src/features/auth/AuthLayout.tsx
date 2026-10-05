import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BabyBadge } from '../../components/ui/BabyBadge.js';
import { LanguageChoice, ThemeChoice } from '../preferences/PreferenceControls.js';

/**
 * The shell for signed-out pages. Deliberately not `AppShell`: someone who is
 * not signed in never sees the application chrome or its navigation.
 */
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-dvh flex-col justify-center bg-canvas px-4 py-10">
      <div className="mx-auto w-full max-w-sm space-y-6">
        <header className="space-y-2 text-center">
          <BabyBadge />
          <h1 className="text-2xl font-semibold text-ink">{t('app.name')}</h1>
          <p className="text-sm text-muted">{t('app.tagline')}</p>
        </header>

        <section className="rounded-card border border-line bg-surface p-6 shadow-soft">
          <h2 className="mb-4 text-lg font-semibold text-ink">{title}</h2>
          {children}
        </section>

        {/* Before signing in too: someone who cannot read the form needs to
            find their language without an account. */}
        <section className="space-y-4 px-1">
          <LanguageChoice />
          <ThemeChoice />
        </section>
      </div>
    </div>
  );
}
