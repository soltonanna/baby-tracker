/**
 * MongoDB lifecycle for integration tests (`*.int.test.ts`).
 *
 * By default an in-memory MongoDB is started per test file, which keeps files
 * independent and lets Vitest run them in parallel. `mongodb-memory-server`
 * downloads a mongod binary on first use.
 *
 * Set `MONGODB_TEST_URI` to run against an already-running MongoDB instead —
 * useful in CI with a service container, behind a restricted network, or when
 * you already have `docker compose up -d` running locally:
 *
 *   MONGODB_TEST_URI=mongodb://127.0.0.1:27017 npm test
 *
 * The mongod version is intentionally not pinned: `mongodb-memory-server`
 * chooses one it knows is published for the current platform.
 */
import { afterAll, afterEach, beforeAll } from 'vitest';
import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';

const DATABASE_NAME = 'baby_tracker_test';

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
  return memoryServer.getUri(DATABASE_NAME);
}

beforeAll(async () => {
  const externalUri = process.env.MONGODB_TEST_URI;
  const uri = externalUri
    ? `${externalUri.replace(/\/+$/, '')}/${DATABASE_NAME}`
    : await startInMemoryMongo();

  await mongoose.connect(uri);
});

afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await memoryServer?.stop();
});
