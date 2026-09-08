import { defineConfig } from 'vitest/config';

/**
 * Separate projects, so the fast feedback loop stays fast:
 *
 *   shared           pure functions, no I/O
 *   api-unit         everything that does not need a database (`*.test.ts`)
 *   api-integration  everything that does (`*.int.test.ts`)
 *   web-unit         browser-side logic that needs no DOM (`*.test.ts`)
 *   web-dom          React components, in jsdom (`*.test.tsx`)
 *
 * `npm test` runs all of them; `npm run test:unit` skips the database entirely.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared',
          root: './packages/shared',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'api-unit',
          root: './apps/api',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.int.test.ts'],
          setupFiles: ['./src/test/env.ts'],
        },
      },
      {
        test: {
          // Node, not jsdom: the logic tested here is the token lifecycle, the
          // refresh policy and the guard rules, and all three are deliberately
          // plain functions. Keeping them out of jsdom keeps them fast.
          name: 'web-unit',
          root: './apps/web',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          // Components, rendered. The `.tsx` suffix is the divide: a test that
          // renders needs a DOM, and nothing else pays for one.
          name: 'web-dom',
          root: './apps/web',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['./src/test/setup-dom.ts'],
        },
      },
      {
        test: {
          name: 'api-integration',
          root: './apps/api',
          environment: 'node',
          include: ['src/**/*.int.test.ts'],
          // Chooses one MongoDB for the whole run, before any worker starts.
          globalSetup: ['./src/test/globalSetup.ts'],
          setupFiles: ['./src/test/env.ts', './src/test/mongo.ts'],
          // Starting a MongoDB instance is slower than a unit test.
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
