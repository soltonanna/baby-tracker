# Baby Tracker — development log

Running record of where the project stands. Updated at the end of each phase.
Product source of truth: `BABY_TRACKER_SPEC.md`.
Architecture and roadmap: `ARCHITECTURE_PROPOSAL.md`.

---

## Current phase

**Phase 0 — Foundation. Complete, awaiting approval.**
Phase 1 (auth, family, babies, navigation) has not been started.

---

## Completed work

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

---

## Known issues and technical debt

- `mongodb-memory-server` is not installed yet. It pulls a large MongoDB binary
  and nothing needed a database in Phase 0; it lands with the first model tests
  in Phase 1.
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

Await approval, then **Phase 1 — auth, family, babies, navigation**:

- API: `User`, `Family`, `FamilyMember`, `Baby`, `RefreshToken` models;
  `authenticate` and `authorize` middleware (membership resolution, roles,
  baby-in-family checks); `auth`, `users`, `families`, `babies` features;
  authorization tests proving one family cannot reach another's data.
- Web: login/register/forgot-password, a create-family wizard that also creates
  Baby A and Baby B, baby profile view and edit, protected routes, and the real
  app shell.
