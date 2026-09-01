/**
 * Chooses the MongoDB for the whole integration run — **once, in the main
 * process** — and hands the URI to every worker.
 *
 * Why this has to be global rather than per test file: starting an in-memory
 * MongoDB is not a per-file-safe operation. `mongodb-memory-server` downloads
 * and caches a mongod binary under a shared lock file, so two workers calling
 * `MongoMemoryServer.create()` at the same moment race each other over
 * `~/.cache/mongodb-binaries/<version>.lock` and fail with
 * `UnableToUnlockLockfileError` or a half-written `.tgz.downloading`. Doing it
 * once, before any worker starts, removes the race by construction instead of
 * papering over it with retries or timeouts.
 *
 * Resolution order:
 *
 *   1. `MONGODB_TEST_URI`, if set. An explicit choice is never second-guessed —
 *      if it is unreachable the run fails loudly rather than silently falling
 *      back to a download the developer did not ask for.
 *   2. The project's own local MongoDB (`docker-compose.yml`). No download, no
 *      environment variable to remember.
 *   3. An in-memory MongoDB, for machines with no Docker and no local server.
 *
 * Test files still each connect to their **own generated database** on whatever
 * server this picks, so isolation between parallel workers is unchanged.
 */
import mongoose from 'mongoose';
import type { TestProject } from 'vitest/node';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { LOCAL_MONGODB_URL, PROBE_TIMEOUT_MS } from './config.js';

let memoryServer: MongoMemoryServer | undefined;

/** Opens and immediately closes a connection, purely to see if anyone answers. */
async function isReachable(url: string): Promise<boolean> {
  try {
    const probe = await mongoose
      .createConnection(url, {
        serverSelectionTimeoutMS: PROBE_TIMEOUT_MS,
        connectTimeoutMS: PROBE_TIMEOUT_MS,
      })
      .asPromise();
    await probe.close();
    return true;
  } catch {
    return false;
  }
}

async function startInMemoryMongo(): Promise<string> {
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  try {
    memoryServer = await MongoMemoryServer.create();
  } catch (error) {
    throw new Error(
      'No MongoDB is available for the integration tests.\n' +
        `  - Nothing is listening on ${LOCAL_MONGODB_URL}. Start one with \`docker compose up -d\`.\n` +
        '  - Falling back to an in-memory MongoDB failed too, usually because the mongod\n' +
        '    binary could not be downloaded (no network, or a blocked host).\n' +
        '  - Or point the tests at any running MongoDB with MONGODB_TEST_URI.\n' +
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return memoryServer.getUri();
}

async function resolveMongoUri(): Promise<{ uri: string; source: 'external' | 'in-memory' }> {
  const explicit = process.env.MONGODB_TEST_URI;

  if (explicit) {
    if (!(await isReachable(explicit))) {
      throw new Error(
        `MONGODB_TEST_URI is set to "${explicit}" but nothing is listening there. ` +
          'Start that server, correct the value, or unset it to let the tests find ' +
          'the local MongoDB or start an in-memory one.',
      );
    }
    return { uri: explicit, source: 'external' };
  }

  if (await isReachable(LOCAL_MONGODB_URL)) {
    return { uri: LOCAL_MONGODB_URL, source: 'external' };
  }

  console.warn(
    `No MongoDB on ${LOCAL_MONGODB_URL} — starting an in-memory one. ` +
      'This is slower and downloads a mongod binary the first time. ' +
      '`docker compose up -d` avoids it.',
  );
  return { uri: await startInMemoryMongo(), source: 'in-memory' };
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const { uri, source } = await resolveMongoUri();

  project.provide('mongoUri', uri);
  project.provide('mongoSource', source);

  console.log(
    source === 'external'
      ? `Integration tests: using the MongoDB at ${uri}`
      : 'Integration tests: using an in-memory MongoDB',
  );

  return async () => {
    await memoryServer?.stop();
  };
}
