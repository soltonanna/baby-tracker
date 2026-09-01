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

**Phase 1A — Authentication. Complete, awaiting approval.**
Phase 1B (families) has not been started.

---

## Completed work

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

---

## Known issues and technical debt

- **The Phase 1A integration tests have not been executed yet.** They were
  written but not run: the sandbox this code was authored in blocks MongoDB's
  download CDN, so `mongodb-memory-server` cannot fetch a mongod binary. Unit
  tests, typecheck, lint, build and a partial live smoke test of the HTTP layer
  all pass. Run `npm run test:integration` once on a machine with normal network
  access to close this out. If the download is blocked there too, use
  `MONGODB_TEST_URI=mongodb://127.0.0.1:27017 npm run test:integration` after
  `docker compose up -d`.
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
- No component tests on the web app. Deferred until there is logic worth
  testing (event forms, baby target picker) in Phase 2.
- `packages/shared` must be built before the API or web typecheck; the root
  scripts do this automatically, but a bare `npx vitest` in `apps/api` will not.

---

## Next step

Await approval, then **Phase 1B — families**:

- API: `Family` and `FamilyMember` models; the authorization chain from
  `ARCHITECTURE_PROPOSAL.md` §4.3 — membership resolution, role checks, and a
  `scope` argument that a service function cannot be called without; `families`
  feature; `GET /auth/me` extended with the caller's families. Authorization
  tests proving one family cannot reach another's data.
- Web: the login and registration screens, protected routes, and the access-token
  refresh retry — deferred from 1A so they land with the onboarding wizard.

Not in 1B: babies (1C), invitations and caregiver management (Phase 6), password
reset and email verification (1D, blocked on an email provider).
