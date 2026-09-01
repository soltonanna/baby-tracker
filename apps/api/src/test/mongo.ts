/**
 * MongoDB lifecycle for integration tests (`*.int.test.ts`).
 *
 * Vitest runs test files in parallel workers, so **every test file gets its own
 * database**, named with a random suffix. That matters more than it looks:
 *
 *   - `afterEach` below wipes every collection. Two files sharing one database
 *     would delete each other's rows mid-test.
 *   - Fixtures collide. Two files that both register `anahit@example.com` would
 *     give the second one a 409.
 *
 * With an in-memory server this used to be hidden, because each file started
 * its own server. Against a shared MongoDB it is not hidden at all, so the
 * isolation is now explicit rather than incidental.
 *
 * Set `MONGODB_TEST_URI` to run against an already-running MongoDB — useful in
 * CI with a service container, behind a restricted network, or when you already
 * have `docker compose up -d` running:
 *
 *   MONGODB_TEST_URI=mongodb://127.0.0.1:27017 npm run test:integration
 *
 * The database name is generated, never taken from the URI, so the suite can
 * never touch real data on a shared server; it is dropped when the file ends.
 * The mongod version is intentionally not pinned: `mongodb-memory-server`
 * chooses one it knows is published for the current platform.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll } from 'vitest';
import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';

/** Unique per test file: this module is evaluated once per file. */
const databaseName = `baby_tracker_test_${randomUUID().replaceAll('-', '')}`;

let memoryServer: MongoMemoryServer | undefined;

async function startInMemoryMongo(): Promise<string> {
  const { MongoMemoryServer: Server } = await import('mongodb-memory-server');
  try {
    memoryServer = await Server.create();
  } catch (error) {
    throw new Error(
      'Could not start an in-memory MongoDB. This usually means the mongod ' +
        'binary could not be downloaded (no network, or a blocked host). ' +
        'Set MONGODB_TEST_URI to point at a running MongoDB instead — for ' +
        'example MONGODB_TEST_URI=mongodb://127.0.0.1:27017 after ' +
        '`docker compose up -d`.\nOriginal error: ' +
        (error instanceof Error ? error.message : String(error)),
      { cause: error },
    );
  }
  return memoryServer.getUri();
}

beforeAll(async () => {
  const uri = process.env.MONGODB_TEST_URI ?? (await startInMemoryMongo());

  // `dbName` overrides whatever database the URI names, so a URI carrying a
  // path or query parameters needs no string surgery and cannot be misread.
  await mongoose.connect(uri, { dbName: databaseName });

  // Build every index before the first test. Without this, a test that relies
  // on the unique index (registering a duplicate email) can race index
  // creation and fail intermittently on a cold database.
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
  await memoryServer?.stop();
});
