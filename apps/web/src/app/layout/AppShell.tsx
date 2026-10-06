import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BabyBadge } from '../../components/ui/BabyBadge.js';
import { Button } from '../../components/ui/Button.js';
import { useAuth } from '../../features/auth/AuthContext.js';
import { LOGIN_PATH } from '../../features/auth/routeAccess.js';
import { BottomNav } from './BottomNav.js';
import { PreferenceSwitchers } from '../../features/preferences/PreferenceControls.js';

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
      {/* Brand and the language / appearance switchers on top, the account
          and its sign-out beneath: on a phone the two rows never crowd each
          other, and the switchers sit in the same place on every screen. */}
      <header className="mx-auto max-w-screen-sm space-y-1 px-4 pt-4 pb-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <BabyBadge size="sm" />
            <h1 className="truncate text-xl font-semibold text-ink">{t('app.name')}</h1>
          </div>
          <PreferenceSwitchers className="shrink-0" />
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm text-muted">
            {user ? t('auth.signedInAs', { name: user.displayName }) : t('app.tagline')}
          </p>
          <Button
            variant="quiet"
            onClick={handleLogout}
            disabled={signingOut}
            className="shrink-0 px-3"
          >
            {signingOut ? t('auth.loggingOut') : t('auth.logout')}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-screen-sm px-4 pb-28">
        <Outlet />
      </main>

      <BottomNav />
    </div>
  );
}
