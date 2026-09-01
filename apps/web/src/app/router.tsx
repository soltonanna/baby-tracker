import { createBrowserRouter } from 'react-router';
import { AppShell } from './layout/AppShell.js';
import { TodayPage } from '../features/system/TodayPage.js';
import { PlaceholderPage } from '../features/system/PlaceholderPage.js';
import { NotFoundPage } from '../features/system/NotFoundPage.js';

export const router = createBrowserRouter([
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
]);
