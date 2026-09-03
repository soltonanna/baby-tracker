import { Navigate, Outlet, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { FullPageLoader } from '../../components/ui/FullPageLoader.js';
import { useAuth } from './AuthContext.js';
import { protectedRouteAccess } from './routeAccess.js';

/** Guards every application page. The rules themselves live in routeAccess.ts. */
export function ProtectedRoute() {
  const { status } = useAuth();
  const { t } = useTranslation();
  const location = useLocation();
  const access = protectedRouteAccess(status);

  if (access.kind === 'loading') {
    return <FullPageLoader label={t('auth.restoring')} />;
  }
  if (access.kind === 'redirect') {
    // Remember where they were headed, so signing in can return them there.
    return <Navigate to={access.to} replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
