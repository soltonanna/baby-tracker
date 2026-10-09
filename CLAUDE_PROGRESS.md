# Baby Tracker — development log

Running record of where the project stands. Updated at the end of each phase.
Product source of truth: `BABY_TRACKER_SPEC.md`.
Architecture and roadmap: `ARCHITECTURE_PROPOSAL.md`.

### Design documents

| Phase | Document                   | Commit    |
| ----- | -------------------------- | --------- |
| 0     | `ARCHITECTURE_PROPOSAL.md` | `1babcfc` |
| 1A    | `docs/phase-1a-auth.md`    | `1992d5c` |

---

## Current phase

**Phase 2B.1 — Family foundation. Complete, awaiting approval.**
Babies and tracker features have not been started.

---

## Completed work

### Phase 2B.2 — MongoDB replica set (2026-09-04)

Infrastructure only. No application behaviour changed.

- `docker-compose.yml` runs mongod with `--replSet rs0`, and a one-shot
  `mongo-init` service initialises the set idempotently after the healthcheck
  passes. No manual `rs.initiate()`, on any run. The member is advertised as
  `localhost:27017` so clients on the host resolve the primary correctly.
- The integration harness uses `MongoMemoryReplSet` instead of
  `MongoMemoryServer`. Per-test-file database isolation is untouched: each file
  still generates its own database name and drops it afterwards.
- Every MongoDB the harness will accept is now a replica set. A standalone —
  including one named explicitly by `MONGODB_TEST_URI` — is refused with an
  explanation rather than used and left to fail inside a transaction.
- A transaction smoke test proves commit, rollback and read isolation actually
  work, rather than trusting that the server reports `setName`.

**D21 is now unblocked but deliberately not acted on.** Family creation still
uses the compensating write from 2B.1. Making transactions available and
adopting them are separate changes, so that a failure in either is easy to
attribute.

### Phase 2B.1 — Family foundation (2026-09-03)

The authorization boundary every future family-scoped resource will use.

- `Family` (name, createdBy, timestamps) and `FamilyMember` (familyId, userId,
  role, timestamps). Roles are `OWNER` and `MEMBER` only.
- Indexes: `{familyId, userId}` unique — both the duplicate-membership
  constraint and the hot "may this user touch this family?" lookup — and
  `{userId}` for listing a caller's families, which the compound index cannot
  serve. Nothing on `Family` beyond `_id`; families are only ever fetched by id.
- `POST /families`, `GET /families`, `GET /families/:familyId`, with
  `authenticate` applied at the router level.
- `requireFamilyMembership` / `requireFamilyRole(...)` resolve the caller's
  membership onto `req.familyScope`, read through `getFamilyScope(req)` —
  mirroring the existing `req.auth` / `getAuth` convention. Service functions
  take the scope rather than a bare id, so a function that cannot be called
  without a resolved membership cannot be called by a non-member.
- Anti-enumeration: a malformed id, a non-existent family and another user's
  family all return a byte-identical 404. A role refusal returns 403, because a
  member already knows the family exists.

### Phase 2A.1 — Frontend authentication (2026-09-02/03)

Register, sign in, session restoration across reload, sign out. Access token in
memory only; refresh through the httpOnly cookie with one in-flight refresh
promise; refresh-and-retry on `TOKEN_EXPIRED`; public and protected route
branches. Two defects found and fixed afterwards: a StrictMode guard that left
session restoration hanging for ever, and `GET /auth/me` being answerable with a
bodyless 304 (auth routes now send `Cache-Control: no-store` and drop
conditional request headers).

### Phase 1A — Authentication (2026-09-01)

Plan: `docs/phase-1a-auth.md`. Three commits: primitives, endpoints, middleware.

- `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`,
  `POST /auth/logout`, `GET /auth/me`.
- Access token: JWT HS256, 15 minutes, verified with an explicit algorithm
  allowlist and a `tokenType` claim. Refresh token: opaque 256 bits, 30 days,
  httpOnly cookie scoped to `/api/v1/auth`, stored only as a SHA-256 hash.
- Rotation on every refresh, claimed atomically so two concurrent refreshes
  cannot both succeed. Reuse of a rotated token revokes the whole `sessionId`
  lineage.
- Passwords: scrypt from `node:crypto`, N=2^16 r=8 p=2, parameters encoded in
  the hash so the cost can be raised later. Unknown emails get a dummy
  verification, so login timing does not reveal which addresses exist.
- Rate limits: 10 logins / 15 min, 5 registrations / hour, 60 refreshes / 15 min.
- 55 unit tests and 30 integration tests.

**Naming note.** The field tying one login's refresh tokens together is
`sessionId`, not `familyId` — `familyId` already means a Baby Tracker family
everywhere else, and the collision would have been actively confusing from
Phase 1B onwards.

### Phase 0 — Foundation (2026-09-01)

- npm workspaces monorepo: `packages/shared`, `apps/api`, `apps/web`.
- Tooling: TypeScript 6.0.3 (strict, `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`), ESLint 10 flat config, Prettier 3, Vitest 4,
  `.editorconfig`, `.nvmrc`, `docker-compose.yml` (MongoDB 8.0).
- `packages/shared`: domain constants and base types, canonical unit conversion
  (D3), and the time-zone/duration primitives behind D4 and D5.
- `apps/api`: Express 5 app, Zod-validated environment, Mongoose connection,
  `HttpError` + error middleware emitting `{ error: { code, message, details } }`,
  `validate` middleware, pino logging, graceful shutdown, `GET /api/v1/health`.
- `apps/web`: Vite + React 19, Tailwind 4 with CSS-first `@theme` tokens
  (light + night palettes), router, TanStack Query, i18next (`ru`/`en`),
  `AppShell` with bottom navigation, three UI primitives, typed `fetch` client,
  and a Today screen that calls `/api/v1/health` to prove the stack end to end.
- 40 tests passing; typecheck, lint, format and build all clean.

**Correctness finding.** `localDayStart` originally computed "local midnight
minus the UTC offset". That is wrong in time zones whose spring daylight-saving
jump happens _at_ midnight, where local midnight does not exist:
`America/Santiago` 2026-09-06 came out as `2026-09-06T03:00Z`, whose local date
is 2026-09-05 — an hour of the previous day folded into the new one. Replaced
with a binary search for the earliest instant whose local date is the target
date, which is correct for ordinary days, skipped midnights and repeated
midnights alike. Covered by a regression test.

---

## Approved architecture decisions

| #   | Decision                                                                                 |
| --- | ---------------------------------------------------------------------------------------- |
| D1  | npm workspaces monorepo: `apps/api`, `apps/web`, `packages/shared`                       |
| D2  | A "both babies" event is **two baby-owned documents sharing a `groupId`**                |
| D3  | Canonical base units in the database (g, mm, ml, °C, s); convert only at the UI boundary |
| D4  | Family-level time zone, with `localDate` denormalised onto events                        |
| D5  | Sleep stays one session; daily totals use overlap with the local calendar day            |
| D6  | Short-lived access token in memory + rotating httpOnly refresh cookie                    |
| D7  | Zod as the shared validation and schema library                                          |
| D8  | Mongoose                                                                                 |
| D9  | Express 5                                                                                |
| D10 | Tailwind CSS + our own small set of UI primitives — no UI kit, no large design system    |
| D11 | Recharts, introduced only when growth/analytics arrive (Phase 4)                         |
| D12 | Private S3-compatible object storage for documents — in principle; provider not chosen   |
| D13 | `clientEventId` idempotency from the start; full offline sync deferred                   |
| D14 | Armenian vaccination schedule seeded first; schedules are data, never hardcoded rules    |
| D15 | Vitest + Supertest + mongodb-memory-server; authorization tests mandatory                |
| D16 | Deployment target deferred until the app is close to a deployable MVP                    |
| D17 | Password hashing: scrypt from `node:crypto`, N=2^16 r=8 p=2 — no dependency              |
| D18 | `jose` for JWT access tokens                                                             |
| D19 | `cookie-parser` for the refresh cookie, unsigned                                         |
| D20 | `express-rate-limit` on the auth routes                                                  |

Phase 1A rulings: access token 15 minutes, refresh token 30 days, **no absolute
session cap yet** — rotation with reuse detection is judged sufficient for the
MVP. `userAgent` is stored on refresh tokens to support a future active-sessions
screen; **no IP addresses**, to minimise personal data.

**Intentional, temporary security trade-off.** `POST /auth/register` returns
`409 EMAIL_TAKEN`, which confirms that an address has an account. Login does not
leak this. Registration is rate limited to five attempts per hour. Revisit when
email verification and password recovery are implemented — the alternative
(always succeed, send an email) needs an email provider we have not chosen.

Spec ambiguities resolved: event ownership → D2; MVP = Phases 0–4; caregiver
roles and authorization from Phase 1, invitation UI in Phase 6; sleep crossing
midnight → D5.

Project framing: a personal/family and portfolio project. Prefer simple
solutions, production-quality security where it matters, no infrastructure or
abstraction built for hypothetical scale.

---

## Open decisions

| #   | Question                                                                  | Needed by      |
| --- | ------------------------------------------------------------------------- | -------------- |
| D12 | Which S3-compatible provider for documents                                | Phase 7        |
| D14 | A reference list for the Armenian vaccination schedule to seed from       | Phase 4        |
| D16 | Deployment target — affects cookie domain/`SameSite` for D6               | End of Phase 2 |
| —   | Whether to enable `exactOptionalPropertyTypes` once Mongoose models exist | Phase 1        |
| —   | Whether to enable type-aware ESLint rules (currently off for speed)       | Any time       |
| —   | Email provider, which unblocks password reset and email verification      | Phase 1D       |
| D21 | Whether to move dev and test Mongo to a single-node replica set           | Before Phase 2 |

---

## Known issues and technical debt

- **The Phase 1A integration tests have not been executed in full yet.** The
  sandbox this code was authored in blocks MongoDB's download CDN and cannot
  reach a host-side MongoDB, so they were written but never run here. Unit
  tests, typecheck, lint, build and a partial live smoke test of the HTTP layer
  all pass. Run `npm run test:integration` to close this out.

  Two rounds of harness defects were found and fixed by running it for real:

  1. Every test file connected to the same `baby_tracker_test` database, so
     parallel files deleted each other's rows in `afterEach` and collided on the
     same fixture email. Each file now generates its own database name and
     drops it when the file ends. The same pass stopped a developer's
     `apps/api/.env` leaking into test runs through dotenv.
  2. Each test file also _created its own MongoDB server_. Two workers calling
     `MongoMemoryServer.create()` at once raced over the shared binary lock file
     and the run died with `UnableToUnlockLockfileError`. The server is now
     chosen once per run in `globalSetup`, which also lets the suite find the
     Docker MongoDB automatically, so `npm run verify` needs no environment
     variable and downloads nothing.

- The mongod version used by `mongodb-memory-server` is not pinned, because it
  could not be verified here. Pin it once a version is known to download
  successfully, for reproducibility.
- When MongoDB is unreachable, Mongoose buffers for ten seconds and the request
  then fails as a 500. A fast 503 would be clearer. Consider `bufferCommands:
false` plus a database-readiness guard in Phase 1B.
- Concurrent refreshes are treated as token reuse and log the user out. This is
  the strict reading of a rotation scheme and is intended, but it means the web
  client must serialise refreshes through a single in-flight request.
- `exactOptionalPropertyTypes` is off. It tends to fight Mongoose document
  types; worth reassessing once real models exist.
- Type-aware ESLint rules are off deliberately — `tsc --noEmit` already catches
  type errors and type-aware linting roughly triples lint time.
- No CI yet. `npm run verify` is the manual equivalent.
- Component tests on the web app run in the `web-dom` Vitest project (jsdom,
  `*.test.tsx`), added in Phase 2C.2. `web-unit` stays on the Node environment
  for the plain-function tests, so only tests that render pay for a DOM.
- `packages/shared` must be built before the API or web typecheck; the root
  scripts do this automatically, but a bare `npx vitest` in `apps/api` will not.

---

## Next step

Await approval, then babies (family-scoped, reusing `requireFamilyMembership`),
and the web UI for families. Neither is started.

Superseded plan, kept for context — **Phase 1B — families**:

- API: `Family` and `FamilyMember` models; the authorization chain from
  `ARCHITECTURE_PROPOSAL.md` §4.3 — membership resolution, role checks, and a
  `scope` argument that a service function cannot be called without; `families`
  feature; `GET /auth/me` extended with the caller's families. Authorization
  tests proving one family cannot reach another's data.
- Web: the login and registration screens, protected routes, and the access-token
  refresh retry — deferred from 1A so they land with the onboarding wizard.

Not in 1B: babies (1C), invitations and caregiver management (Phase 6), password
reset and email verification (1D, blocked on an email provider).

---

## Growth — weight, length, head circumference (2026-10-07)

Stages G1–G4, on top of `2b8226c`.

- **Data.** `GrowthMeasurement` collection, one record per visit with any of
  `weightGrams` / `lengthMm` / `headCircumferenceMm` (canonical, D3),
  `measuredOn` as a calendar date at UTC midnight, optional `source`
  (PARENT/DOCTOR) and `note`, soft delete. CRUD at
  `/families/:f/babies/:b/growth`. Babies gained `PATCH` and an optional
  `gestationalAge { weeks, days }`.
- **WHO.** Daily LMS tables (birth–day 730) from WHO's `anthro` repository,
  generated by `scripts/generate-who-tables.mjs`; provenance in
  `packages/shared/who-data/README.md`. Tests check them against the monthly
  PDFs in `who_standards/`. Imported as `@baby-tracker/shared/growth` so the
  ~100 kB of tables load only with the lazily loaded Growth screen.
- **Comparison.** WHO z-score (with restricted extrapolation beyond ±3 SD) →
  percentile, shown as "WHO percentile: N". Babies born before 37 weeks are
  compared by corrected age until 2 years. Nothing derived is stored, and no
  wording says a value is good or bad (project rules §7).
- **UI.** Health tab → Growth: latest values, change since the previous
  measurement, percentile, a hand-drawn SVG chart on the WHO 2nd–98th band,
  and the full list with edit/delete. Today has an "Add measurement" shortcut.

Not done: head-circumference PDFs are not in `who_standards/` (the daily HC
table is WHO's, but has no PDF cross-check here); BMI-for-age and
weight-for-length; comparison beyond 2 years; integration tests are written
but unrun here — run `npm run test:integration`.

---

## Family data — export, import, reset, test data (2026-10-08)

On top of `a1ce9a2`. Not committed.

- **API.** `/families/:f/data` behind `requireFamilyMembership`:
  `GET /export` (any member; JSON download, `Cache-Control: no-store`),
  `POST /import` (OWNER), `DELETE /` (OWNER). Feature in
  `apps/api/src/features/familyData/`.
- **Scope.** Babies, tracker events and growth measurements only. User,
  family, membership and refresh tokens are never touched, so a reset or an
  import never signs anyone out.
- **Import replaces, never merges.** Re-importing a file must not duplicate
  it, and merging would turn twins into four babies (both-babies needs exactly
  two). Delete + insert run in one transaction, so a bad file changes nothing.
  Babies get new ObjectIds; file ids are file-local labels mapped on import.
  `createdAt`/`updatedAt` from the file are kept (`insertMany` with
  `timestamps: false`), which also keeps the babies' order.
- **Clear is a hard delete**, including soft-deleted measurements: it is the
  explicit, confirmed reset. Export is offered first in the UI copy.
- **File format.** `familyDataSchema` in shared (`format:
'baby-tracker/family-data'`, `version: 1`), validated by the API and by the
  web page before anything is sent. Same value rules as the create schemas.
- **Body size.** The app-wide JSON parser (1 MB) skips the import path; the
  import route parses up to 25 MB itself, after authentication and the owner
  check. body-parser errors now map to 413 `PAYLOAD_TOO_LARGE` / 400
  `INVALID_JSON` instead of 500.
- **Web.** More tab → `features/data/DataPage.tsx`: Export / Import (file
  summary, then confirm) / Clear (confirm). Import and clear shown to the owner
  only. All queries invalidated after import or clear.
- **Test data.** `npm run generate:test-data` → `test-data/twins-test-data.json`
  (gitignored): twins Aram (boy) and Ani (girl), born 2026-04-01 at 36+2,
  every day up to now — ~7k events, grouped "both" notes, 32 growth visits
  following WHO curves by corrected age. Options: `--birth`, `--until`,
  `--seed`, `--out`.

Untested here: `familyData.int.test.ts` is written but unrun (no MongoDB in
the sandbox) — run `npm run test:integration`.

---

## Feeding kinds and the daily feeding summary (2026-10-09)

On top of the 2026-10-08 family-data work. Not committed.

- **Kinds.** A feeding is `breast`, `expressed_milk` or `formula`
  (`FEEDING_KINDS`; the unused `FEEDING_METHODS`/`BOTTLE_CONTENTS` are gone).
  Stored in a new optional `feeding` object on the event — the first typed
  per-type data (`ARCHITECTURE_PROPOSAL.md` §5.5): `{ kind: 'breast', side? }`
  or `{ kind: 'expressed_milk' | 'formula' }`. Feedings recorded before this
  have no `feeding` and stay valid and unchanged.
- **Rules** (`eventRuleIssues` in shared): `feeding` only on FEEDING; a
  breastfeed never has an `amount` (so no volume total can include an invented
  number); a bottle kind needs one. Checked by the create, both-babies and
  import schemas, and for PATCH by the service against the event _as it would
  be_ after the patch.
- **Clearing.** PATCH now accepts `null` for `endedAt`, `amount`, `unit` =
  remove the field (absent still = unchanged). Needed when a feeding changes
  kind: bottle → breast drops the volume, breast → bottle drops the end time.
- **Form.** Type pills (Breast · Expressed milk · Formula). Breast: optional
  side, start, optional end with quick +5/10/15/20/30 min; an end that would
  make a feed longer than 4 h is questioned (usually an end typed before the
  start, which the next-day rule would read as ~24 h). Bottles: amount + unit as
  before. A new feeding starts on the kind of the baby's last feeding today.
  `components/ui/PillRadioGroup.tsx` is the reusable pill radio group.
- **Summary.** `summariseFeedingDay` / `countDiapers` in
  `packages/shared/src/feedingSummary.ts` (pure, unit-tested), rendered by
  `features/tracker/FeedingSummary.tsx` above Today's list: count by kind,
  time since last, average / shortest / longest interval (start to start),
  _measured bottle volume_ only, breastfeeding time from the feeds that have an
  end, wet/dirty nappies, a 24-hour strip and night/morning/afternoon/evening
  counts. When any breastfeed exists, a neutral note explains that its volume
  is not measured and points to feedings + nappies + weight + how the baby
  seems, with the paediatrician. No "enough/not enough" anywhere.
- **Carry-over.** Today also reads the previous local day (`limit=200`,
  `previousDayRange` in `day.ts`) so the first interval and "since last" start
  from yesterday's last feeding. Same query-key prefix, so existing
  invalidations refresh it. Tests tell the two reads apart by that `limit`.
- **Test data.** The generator now produces mixed feeding (mostly breast with
  side and usually an end; expressed milk and formula bottles with volume).

Untested here: the new integration tests in `events.int.test.ts` ("feeding
kinds") and `familyData.int.test.ts` ("feeding kinds in the data file") are
written but unrun — run `npm run test:integration`.
