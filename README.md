# Baby Tracker

A twin-first daily journal and family health record for babies.

Product source of truth: [`BABY_TRACKER_SPEC.md`](./BABY_TRACKER_SPEC.md).
Architecture, data model, API and roadmap: [`ARCHITECTURE_PROPOSAL.md`](./ARCHITECTURE_PROPOSAL.md).

> **Not a medical application.** Baby Tracker stores and displays what a parent
> or doctor entered. It does not diagnose, does not recommend or calculate
> medication doses, and does not judge whether a baby is healthy.

---

## Requirements

- **Node.js 22.22.0 or newer** (`.nvmrc` pins 22.23.2 — `nvm use`)
- **MongoDB 8.0** — either `docker compose up -d`, a local install, or MongoDB Atlas

## Getting started

```bash
nvm use                # or make sure node -v is >= 22.22.0
npm install
npm run setup          # creates apps/api/.env with a generated JWT_SECRET
docker compose up -d   # MongoDB on :27017
npm run dev
```

- Web app: <http://localhost:5173>
- API: <http://localhost:4000/api/v1/health>

`npm run setup` never overwrites an existing `apps/api/.env`, so it is safe to
re-run. It generates the secret locally; nothing secret is committed, and
`apps/api/.env.example` deliberately ships an **empty** `JWT_SECRET` so that
copying it by hand fails at startup rather than running every clone on the same
well-known value. The API requires a secret of at least 32 characters in every
environment and refuses to start without one.

The Vite dev server proxies `/api` to the API, so the browser talks to a single
origin — the same shape the httpOnly refresh cookie will need in production.

The API starts even when MongoDB is unreachable; `/api/v1/health` reports the
real connection state, so the foundation can be inspected before a database
exists.

## Scripts

| Command             | What it does                                 |
| ------------------- | -------------------------------------------- |
| `npm run dev`       | Shared package in watch mode + API + web     |
| `npm run build`     | Production build of all three workspaces     |
| `npm run typecheck` | `tsc` across every workspace, tests included |
| `npm run lint`      | ESLint across the monorepo                   |
| `npm run format`    | Prettier write (`format:check` to verify)    |
| `npm test`          | Vitest, all projects                         |
| `npm run verify`    | format:check → lint → typecheck → test       |

## Structure

```text
packages/shared   Domain types, Zod schemas, unit conversion, time helpers
apps/api          Express 5 + Mongoose REST API
apps/web          React 19 + Vite mobile-first client
```

Both apps import `@baby-tracker/shared`, so a request body the client builds and
the schema the server validates come from one definition.

## Pinned versions

Chosen on 2026-09-01 as the newest **mutually compatible** stable set.

| Package           | Version | Note                                                                                                                                                              |
| ----------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node              | 22.23.2 | React Router 8 requires ≥ 22.22.0                                                                                                                                 |
| TypeScript        | ~6.0.3  | **Not 7.0.2.** `typescript-eslint@8` declares `typescript >=4.8.4 <6.1.0`, so TS 7 breaks linting. Pinned with `~` so it cannot drift into 6.1.                   |
| Express           | 5.2.1   | Forwards async rejections to the error handler natively — no `asyncHandler` wrapper needed                                                                        |
| Mongoose          | 9.9.4   |                                                                                                                                                                   |
| Zod               | 4.5.4   | Shared by API and web                                                                                                                                             |
| React / React DOM | 19.2.8  |                                                                                                                                                                   |
| React Router      | 8.3.1   |                                                                                                                                                                   |
| TanStack Query    | 5.102.8 | Server state; no Redux                                                                                                                                            |
| Tailwind CSS      | 4.3.3   | CSS-first `@theme`, no `tailwind.config.js`                                                                                                                       |
| Vite              | 8.2.2   |                                                                                                                                                                   |
| Vitest            | 4.1.11  |                                                                                                                                                                   |
| ESLint            | 10.9.1  | Flat config, type-aware rules intentionally off                                                                                                                   |
| Prettier          | 3.9.6   |                                                                                                                                                                   |
| pino              | 10.3.1  |                                                                                                                                                                   |
| MongoDB server    | 8.0     | Not 6.0: its security support ended 2025-07-31. Mongoose 9 supports 6.x/7.x/8.x, so this is a lifecycle choice, not a driver one. 8.0 is supported to 2029-10-31. |

Dependencies deliberately **not** taken:

- **axios** — native `fetch` is enough, and the refresh-retry logic is ours anyway.
- **date-fns-tz / luxon** — the time-zone maths the product needs is ~40 tested
  lines over `Intl.DateTimeFormat` (`packages/shared/src/time.ts`).
- **A UI kit** — Tailwind plus a small set of our own primitives, so the
  one-handed twin interaction model is not fighting someone else's components.

## Time zones and daylight saving

`packages/shared/src/time.ts` owns every calendar decision, and it is the one
place worth reading before trusting a daily total.

`localDayStart` finds the first instant belonging to a local date by binary
search rather than subtracting the UTC offset from midnight, because **local
midnight does not always exist**. In `America/Santiago` the spring daylight-saving
jump happens at midnight, so 2026-09-06 begins at 01:00 local time; subtracting
the offset lands an hour into the previous day. `Asia/Beirut` has the same shape
of transition. The tests cover Yerevan (no DST), Berlin (ordinary DST), Beirut
and Santiago (midnight transitions), in both directions, plus a sweep asserting
that consecutive days never overlap and never leave a gap.

## Tests

```bash
npm test                 # everything
npm run test:unit        # no database needed — fast
npm run test:integration # database-backed tests only
```

Database-backed tests are named `*.int.test.ts` and run in their own Vitest
project. **No setup beyond `docker compose up -d` is needed** — the suite finds
MongoDB by itself, in this order:

1. `MONGODB_TEST_URI`, if you set it. An explicit choice is never second-guessed:
   if nothing is listening there the run fails loudly rather than quietly
   downloading a MongoDB you did not ask for.
2. The project's local MongoDB on `127.0.0.1:27017` — the port
   `docker-compose.yml` publishes.
3. An in-memory MongoDB, for machines with no Docker and no local server. This
   downloads a mongod binary the first time.

The server is chosen **once per run**, in `apps/api/src/test/globalSetup.ts`,
before any worker starts. That is not just tidiness: `mongodb-memory-server`
caches its binary under a shared lock file, so two workers starting one
simultaneously race each other over `<version>.lock` and the run fails.

Vitest runs test files in parallel, so **each file gets its own database** on
whichever server was chosen, named with a random suffix and dropped when the
file finishes. The suite is therefore safe against a shared or non-empty MongoDB
and never touches a database it did not create.

Password hashing is deliberately expensive (scrypt, 64 MiB), so tests that hash
a password take a few hundred milliseconds each. That cost is the feature.

## Conventions

- All instants are stored **UTC**; every event also carries `localDate`
  (`YYYY-MM-DD` in the family's time zone) so "today" is an indexed lookup.
- All measurements are stored in **canonical base units**: grams, millimetres,
  millilitres, °C, seconds. Conversion happens only at the UI boundary.
- Errors are always `{ "error": { "code", "message", "details"? } }`.
- No endpoint trusts a `familyId` from the client; access is resolved from the
  authenticated user's family membership.
