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
 *      if it is unreachable, or is not a replica set, the run fails loudly
 *      rather than silently falling back to something the developer did not
 *      ask for.
 *   2. The project's own local MongoDB (`docker-compose.yml`). No download, no
 *      environment variable to remember.
 *   3. An in-memory replica set, for machines with no Docker and no local
 *      server.
 *
 * Every option is a **replica set**, because MongoDB only offers
 * multi-document transactions on one. A standalone server is rejected with an
 * explanation rather than used and left to fail later inside a transaction.
 *
 * Test files still each connect to their **own generated database** on whatever
 * server this picks, so isolation between parallel workers is unchanged.
 */
import mongoose from 'mongoose';
import type { TestProject } from 'vitest/node';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  LOCAL_MONGODB_PROBE_URL,
  LOCAL_MONGODB_URL,
  PROBE_TIMEOUT_MS,
  REPLICA_SET_NAME,
} from './config.js';

let memoryServer: MongoMemoryReplSet | undefined;

interface Probe {
  reachable: boolean;
  /** The replica set the server belongs to, absent on a standalone. */
  setName?: string | undefined;
}

/** Opens and immediately closes a connection, to see who answers and what it is. */
async function probe(url: string): Promise<Probe> {
  let connection: mongoose.Connection | undefined;
  try {
    connection = await mongoose
      .createConnection(url, {
        serverSelectionTimeoutMS: PROBE_TIMEOUT_MS,
        connectTimeoutMS: PROBE_TIMEOUT_MS,
      })
      .asPromise();

    const hello = (await connection.db?.admin().command({ hello: 1 })) as
      { setName?: string } | undefined;

    return { reachable: true, setName: hello?.setName };
  } catch {
    return { reachable: false };
  } finally {
    await connection?.close();
  }
}

async function startInMemoryMongo(standaloneFound: boolean): Promise<string> {
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  try {
    // A one-node replica set rather than a standalone server: the same reason
    // docker-compose.yml runs one. wiredTiger is stated rather than assumed,
    // because transactions need a storage engine that supports them.
    memoryServer = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
  } catch (error) {
    throw new Error(
      'No transactional MongoDB is available for the integration tests.\n' +
        (standaloneFound
          ? '  - The MongoDB on 127.0.0.1:27017 is a standalone server, not a replica set,\n' +
            '    so it cannot run transactions. Recreate it with `docker compose up -d`\n' +
            '    (see README, "MongoDB runs as a single-node replica set").\n'
          : '  - Nothing is listening on 127.0.0.1:27017. Start one with `docker compose up -d`.\n') +
        '  - Falling back to an in-memory replica set failed too, usually because the\n' +
        '    mongod binary could not be downloaded (no network, or a blocked host).\n' +
        '  - Or point the tests at any running replica set with MONGODB_TEST_URI.\n' +
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return memoryServer.getUri();
}

async function resolveMongoUri(): Promise<{ uri: string; source: 'external' | 'in-memory' }> {
  const explicit = process.env.MONGODB_TEST_URI;

  if (explicit) {
    const result = await probe(explicit);

    if (!result.reachable) {
      throw new Error(
        `MONGODB_TEST_URI is set to "${explicit}" but nothing is listening there. ` +
          'Start that server, correct the value, or unset it to let the tests find ' +
          'the local MongoDB or start an in-memory one.',
      );
    }
    if (!result.setName) {
      // Loudly, not by quietly substituting something else: an explicit choice
      // that cannot run transactions is a mistake worth surfacing.
      throw new Error(
        `MONGODB_TEST_URI is set to "${explicit}", which is a standalone MongoDB. ` +
          'The integration tests need a replica set, because MongoDB only supports ' +
          'transactions on one. Point it at a replica set, or unset it to use the ' +
          "project's local MongoDB or an in-memory replica set.",
      );
    }
    return { uri: explicit, source: 'external' };
  }

  const local = await probe(LOCAL_MONGODB_PROBE_URL);

  if (local.reachable && local.setName) {
    return { uri: LOCAL_MONGODB_URL, source: 'external' };
  }

  console.warn(
    local.reachable
      ? 'The MongoDB on 127.0.0.1:27017 is a standalone server, not a replica set, so ' +
          'it cannot run transactions — starting an in-memory replica set instead. ' +
          '`docker compose up -d` recreates it as a replica set and is much faster.'
      : 'No MongoDB on 127.0.0.1:27017 — starting an in-memory replica set. ' +
          'This is slower and downloads a mongod binary the first time. ' +
          '`docker compose up -d` avoids it.',
  );
  return { uri: await startInMemoryMongo(local.reachable), source: 'in-memory' };
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const { uri, source } = await resolveMongoUri();

  project.provide('mongoUri', uri);
  project.provide('mongoSource', source);

  console.log(
    source === 'external'
      ? `Integration tests: using the MongoDB at ${uri}`
      : `Integration tests: using an in-memory replica set (${REPLICA_SET_NAME} equivalent)`,
  );

  return async () => {
    await memoryServer?.stop();
  };
}
