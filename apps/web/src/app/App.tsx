import { RouterProvider } from 'react-router';
import { AppProviders } from './providers.js';
import { router } from './router.js';

export function App() {
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
