/**
 * Test environment variables.
 *
 * Vitest loads setup files before the test module graph, so these are in place
 * before `config/env.ts` is evaluated. Loaded by both test projects.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL ??= 'silent';
process.env.JWT_SECRET ??= 'test-only-secret-value-of-at-least-32-chars';
