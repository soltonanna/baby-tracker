/**
 * Initialises the local MongoDB as a single-node replica set — idempotently.
 *
 * Run by the `mongo-init` service in docker-compose.yml, over a *direct*
 * connection, after the `mongo` service reports healthy. Safe to run on every
 * `docker compose up`: an already-initialised set is detected and left alone.
 *
 * Why a replica set at all: MongoDB only offers multi-document transactions on
 * a replica set or a sharded cluster. A standalone mongod rejects them with
 * `IllegalOperation`, so `session.withTransaction()` cannot be used at all.
 *
 * Why the member host is `localhost:27017` rather than the container name:
 * clients on the developer's machine connect through the published port and
 * then follow the replica-set configuration to find the primary. Advertising
 * `mongo:27017` would send them to a hostname that only resolves inside the
 * Docker network. `localhost:27017` resolves correctly both from the host and
 * from inside the container, which is what a single-node development set needs.
 */
const REPLICA_SET = 'rs0';
const MEMBER_HOST = 'localhost:27017';
const PRIMARY_TIMEOUT_MS = 60000;
const POLL_INTERVAL_MS = 250;

/** MongoDB's error code for "this node has no replica-set configuration yet". */
const NOT_YET_INITIALIZED = 94;

function alreadyInitialised() {
  try {
    rs.status();
    return true;
  } catch (error) {
    if (error.code === NOT_YET_INITIALIZED || error.codeName === 'NotYetInitialized') {
      return false;
    }
    // Anything else is a real problem and must not be mistaken for "not set up".
    throw error;
  }
}

if (alreadyInitialised()) {
  print('[mongo-init] replica set ' + REPLICA_SET + ' is already initialised');
} else {
  print('[mongo-init] initialising replica set ' + REPLICA_SET);
  rs.initiate({ _id: REPLICA_SET, members: [{ _id: 0, host: MEMBER_HOST }] });
}

/**
 * Election takes a moment even for a single node, and a set that is not yet
 * writable would fail the first transaction. Poll rather than sleep a fixed
 * amount, so this is neither flaky nor slower than it needs to be.
 */
const deadline = Date.now() + PRIMARY_TIMEOUT_MS;
let writable = false;

while (Date.now() < deadline) {
  try {
    if (db.hello().isWritablePrimary) {
      writable = true;
      break;
    }
  } catch {
    // Still electing; keep waiting until the deadline.
  }
  sleep(POLL_INTERVAL_MS);
}

if (!writable) {
  print('[mongo-init] timed out waiting for the node to become PRIMARY');
  quit(1);
}

print('[mongo-init] replica set ' + REPLICA_SET + ' is ready and the node is PRIMARY');
