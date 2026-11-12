import { createBrowserRouter, type RouteObject } from 'react-router';
import { AppShell } from './layout/AppShell.js';
import { ProtectedRoute } from '../features/auth/ProtectedRoute.js';
import { PublicOnlyRoute } from '../features/auth/PublicOnlyRoute.js';
import { LoginPage } from '../features/auth/LoginPage.js';
import { RegisterPage } from '../features/auth/RegisterPage.js';
import { TodayPage } from '../features/tracker/TodayPage.js';
import { TimelinePage } from '../features/timeline/TimelinePage.js';
import { NotFoundPage } from '../features/system/NotFoundPage.js';
import { DataPage } from '../features/data/DataPage.js';
import { SettingsPage } from '../features/settings/SettingsPage.js';

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
          { path: 'timeline', Component: TimelinePage },
          // Growth is the first Health section; medical history, vaccinations
          // and appointments join it later.
          // Lazy: the screen carries the WHO tables, which the daily tracker
          // never needs, so they load only when Health is opened.
          {
            path: 'health',
            lazy: async () => ({
              Component: (await import('../features/growth/GrowthPage.js')).GrowthPage,
            }),
          },
          // More holds the data tools for now: export, import, reset. Settings
          // and caregivers join it in Phase 6.
          { path: 'more', Component: DataPage },
          // Settings: the children's profiles. Reached from the gear in the
          // header rather than the bottom navigation.
          { path: 'settings', Component: SettingsPage },
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
