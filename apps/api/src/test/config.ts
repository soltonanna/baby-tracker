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
export const LOCAL_MONGODB_URL = 'mongodb://127.0.0.1:27017';

/** How long to wait when deciding whether that server is there. Kept short: it
 *  is a liveness probe, not a connection the tests will use. */
export const PROBE_TIMEOUT_MS = 1500;
