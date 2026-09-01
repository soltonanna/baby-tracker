/**
 * Per-test-file MongoDB lifecycle for integration tests (`*.int.test.ts`).
 *
 * The server itself is chosen once per run by `globalSetup.ts`; this file only
 * connects to it. Vitest runs test files in parallel workers, so **every test
 * file gets its own database**, named with a random suffix. That matters more
 * than it looks:
 *
 *   - `afterEach` below wipes every collection. Two files sharing one database
 *     would delete each other's rows mid-test.
 *   - Fixtures collide. Two files that both register `anahit@example.com` would
 *     give the second one a 409.
 *
 * The database name is always generated and never taken from the URI, so the
 * suite can be pointed at a shared or non-empty server without ever touching a
 * database it did not create, and it drops its own when the file ends.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, inject } from 'vitest';
import mongoose from 'mongoose';

/** Unique per test file: this module is evaluated once per file. */
const databaseName = `baby_tracker_test_${randomUUID().replaceAll('-', '')}`;

beforeAll(async () => {
  // `dbName` overrides whatever database the URI names, so a URI carrying a
  // path or query parameters needs no string surgery and cannot be misread.
  await mongoose.connect(inject('mongoUri'), { dbName: databaseName });

  // Build every index before the first test. Without this, a test that relies
  // on the unique email index can race index creation on a cold database.
  await Promise.all(Object.values(mongoose.connection.models).map((model) => model.init()));
});

afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  // Leave no databases behind on a shared server.
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
  }
  await mongoose.disconnect();
});
