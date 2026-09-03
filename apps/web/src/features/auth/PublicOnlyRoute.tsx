import { Navigate, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { FullPageLoader } from '../../components/ui/FullPageLoader.js';
import { useAuth } from './AuthContext.js';
import { publicOnlyRouteAccess } from './routeAccess.js';

/** Sign-in and sign-up. An already-signed-in visitor is sent to the app. */
export function PublicOnlyRoute() {
  const { status } = useAuth();
  const { t } = useTranslation();
  const access = publicOnlyRouteAccess(status);

  if (access.kind === 'loading') {
    return <FullPageLoader label={t('auth.restoring')} />;
  }
  if (access.kind === 'redirect') {
    return <Navigate to={access.to} replace />;
  }
  return <Outlet />;
}
