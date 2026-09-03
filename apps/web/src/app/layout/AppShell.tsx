import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button.js';
import { useAuth } from '../../features/auth/AuthContext.js';
import { LOGIN_PATH } from '../../features/auth/routeAccess.js';
import { BottomNav } from './BottomNav.js';

export function AppShell() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  async function handleLogout(): Promise<void> {
    setSigningOut(true);
    // `logout` clears local state even if the request fails, so this always
    // ends on the login page.
    await logout();
    await navigate(LOGIN_PATH, { replace: true });
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="mx-auto flex max-w-screen-sm items-start justify-between gap-4 px-4 pt-6 pb-2">
        <div>
          <h1 className="text-xl font-semibold text-ink">{t('app.name')}</h1>
          <p className="text-sm text-muted">
            {user ? t('auth.signedInAs', { name: user.displayName }) : t('app.tagline')}
          </p>
        </div>

        <Button variant="quiet" onClick={handleLogout} disabled={signingOut}>
          {signingOut ? t('auth.loggingOut') : t('auth.logout')}
        </Button>
      </header>

      <main className="mx-auto max-w-screen-sm px-4 pb-28">
        <Outlet />
      </main>

      <BottomNav />
    </div>
  );
}
