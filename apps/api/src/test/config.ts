/**
 * Where the integration tests look for MongoDB.
 *
 * This is deliberately a committed project constant rather than something each
 * developer exports in their shell: the address is a property of *this project*
 * — it is the port `docker-compose.yml` publishes — not of anyone's machine. A
 * developer who has run `docker compose up -d` should be able to run
 * `npm test` and `npm run verify` with no further setup.
 *
 * `MONGODB_TEST_URI` still overrides it, for CI or a non-standard port.
 */

/** Must match the replica set name in `docker-compose.yml`. */
export const REPLICA_SET_NAME = 'rs0';

/**
 * How the tests connect: through the replica set, because transactions are only
 * available on one.
 */
export const LOCAL_MONGODB_URL = `mongodb://127.0.0.1:27017/?replicaSet=${REPLICA_SET_NAME}`;

/**
 * How the tests *look*: a direct connection, deliberately.
 *
 * Probing with `?replicaSet=` would fail identically whether nothing is
 * listening or a standalone mongod is. Connecting directly lets the harness
 * tell those apart and say which one it found.
 */
export const LOCAL_MONGODB_PROBE_URL = 'mongodb://127.0.0.1:27017/?directConnection=true';

/** How long to wait when deciding whether that server is there. Kept short: it
 *  is a liveness probe, not a connection the tests will use. */
export const PROBE_TIMEOUT_MS = 1500;
