import { defineConfig } from 'vitest/config';

/**
 * Three projects, so the fast feedback loop stays fast:
 *
 *   shared           pure functions, no I/O
 *   api-unit         everything that does not need a database (`*.test.ts`)
 *   api-integration  everything that does (`*.int.test.ts`)
 *
 * `npm test` runs all three; `npm run test:unit` skips the database entirely.
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
          name: 'api-integration',
          root: './apps/api',
          environment: 'node',
          include: ['src/**/*.int.test.ts'],
          setupFiles: ['./src/test/env.ts', './src/test/mongo.ts'],
          // Starting a MongoDB instance is slower than a unit test.
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
