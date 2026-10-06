import { createBrowserRouter, type RouteObject } from 'react-router';
import { AppShell } from './layout/AppShell.js';
import { ProtectedRoute } from '../features/auth/ProtectedRoute.js';
import { PublicOnlyRoute } from '../features/auth/PublicOnlyRoute.js';
import { LoginPage } from '../features/auth/LoginPage.js';
import { RegisterPage } from '../features/auth/RegisterPage.js';
import { TodayPage } from '../features/tracker/TodayPage.js';
import { PlaceholderPage } from '../features/system/PlaceholderPage.js';
import { NotFoundPage } from '../features/system/NotFoundPage.js';

/**
 * Two branches under pathless layout routes.
 *
 * Everything the application shows lives behind `ProtectedRoute`, so `AppShell`
 * — the navigation, the header, the pages — is never rendered for someone who
 * is not signed in. Sign-in and sign-up sit behind `PublicOnlyRoute`, which
 * sends an already-authenticated visitor into the app instead.
 */
const routes: RouteObject[] = [
  {
    Component: PublicOnlyRoute,
    children: [
      { path: '/login', Component: LoginPage },
      { path: '/register', Component: RegisterPage },
    ],
  },
  {
    Component: ProtectedRoute,
    children: [
      {
        path: '/',
        Component: AppShell,
        children: [
          { index: true, Component: TodayPage },
          {
            path: 'timeline',
            element: <PlaceholderPage titleKey="nav.timeline" phase="Phase 2" />,
          },
          {
            path: 'health',
            element: <PlaceholderPage titleKey="nav.health" phase="Phase 4" />,
          },
          {
            path: 'more',
            element: <PlaceholderPage titleKey="nav.more" phase="Phase 6" />,
          },
          { path: '*', Component: NotFoundPage },
        ],
      },
    ],
  },
];

/**
 * Vite's base path — `/baby-tracker/` on GitHub Pages, `/` locally — without the
 * trailing slash, so links and redirects work under the repository sub-path.
 */
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

export const router = createBrowserRouter(routes, { basename });
