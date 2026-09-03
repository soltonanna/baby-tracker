import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The shell for signed-out pages. Deliberately not `AppShell`: someone who is
 * not signed in never sees the application chrome or its navigation.
 */
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-dvh flex-col justify-center bg-canvas px-4 py-10">
      <div className="mx-auto w-full max-w-sm space-y-6">
        <header className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold text-ink">{t('app.name')}</h1>
          <p className="text-sm text-muted">{t('app.tagline')}</p>
        </header>

        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="mb-4 text-lg font-semibold text-ink">{title}</h2>
          {children}
        </section>
      </div>
    </div>
  );
}
