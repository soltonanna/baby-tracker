/**
 * Test environment. Loaded by both test projects.
 *
 * Vitest executes setup files before the test module graph, so everything here
 * is in place before `config/env.ts` is evaluated.
 *
 * Two rules make the suite deterministic on any machine:
 *
 *   1. `DOTENV_CONFIG_PATH` points at a file that does not exist, so a
 *      developer's `apps/api/.env` cannot leak into a test run. Without this,
 *      someone whose `.env` sets `COOKIE_SECURE=true` or a different access
 *      token lifetime would see assertions fail for no visible reason.
 *   2. Values are assigned, not defaulted with `??=`, so nothing the shell
 *      already exported can change what the tests assert.
 *
 * `MONGODB_TEST_URI` is deliberately left alone — it is the one variable a
 * developer or CI is meant to control (see `test/mongo.ts`).
 */
process.env.DOTENV_CONFIG_PATH = '/nonexistent/.env.tests-do-not-read-dotenv';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'test-only-secret-value-of-at-least-32-chars';
process.env.CORS_ORIGIN = 'http://localhost:5173';

// Asserted on directly by the auth tests.
process.env.ACCESS_TOKEN_TTL_SECONDS = '900';
process.env.REFRESH_TOKEN_TTL_DAYS = '30';
process.env.COOKIE_SECURE = 'false';
process.env.COOKIE_SAMESITE = 'lax';
