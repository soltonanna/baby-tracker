import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// The real i18n instance, so component tests assert on the strings the app
// actually ships rather than on key names. jsdom reports `en-US`, so the
// English catalogue is selected exactly as it would be in a browser.
import '../i18n/index.js';

// React Testing Library does not unmount between tests on its own outside of
// its own globals setup; without this, each test would find the previous
// test's DOM still attached.
afterEach(() => {
  cleanup();
});
