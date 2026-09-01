import { Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BottomNav } from './BottomNav.js';

export function AppShell() {
  const { t } = useTranslation();

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="mx-auto max-w-screen-sm px-4 pt-6 pb-2">
        <h1 className="text-xl font-semibold text-ink">{t('app.name')}</h1>
        <p className="text-sm text-muted">{t('app.tagline')}</p>
      </header>

      <main className="mx-auto max-w-screen-sm px-4 pb-28">
        <Outlet />
      </main>

      <BottomNav />
    </div>
  );
}
