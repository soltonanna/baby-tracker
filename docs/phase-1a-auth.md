# Phase 1A — Authentication: architecture and implementation plan

Status: **proposal, awaiting approval. No code written.**
Baseline: commit `1babcfc` (Phase 0 foundation, approved).
Date: 2026-09-01

Reads on: `BABY_TRACKER_SPEC.md` §27 (authentication) and §37 (privacy and
security); `ARCHITECTURE_PROPOSAL.md` §4.3 (authorization), §5.1 (`users`),
§5.14 (`refresh_tokens`), §6 (auth endpoints), decision D6.

---

## 1. Scope

**In scope.** Registration, login, access tokens, httpOnly refresh cookie,
refresh-token rotation with reuse detection, logout, `GET /auth/me`, password
hashing, request validation, and the `authenticate` middleware.

**Explicitly out of scope for 1A**, to be planned separately:

| Deferred                           | Why                                                                                                             | Lands in                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Families, babies                   | Phase 1B / 1C                                                                                                   | 1B, 1C                          |
| Invitations, caregiver roles       | Needs families first; spec §19 and D-ruling put the UI in Phase 6                                               | 6                               |
| Password reset, email verification | Both need an email provider, which is an unmade decision with cost and vendor implications                      | 1D, after you choose a provider |
| Google / Apple login               | Spec §27 lists these as "in future"                                                                             | post-MVP                        |
| Web login/registration UI          | 1A is the API and its middleware; the screens come with 1B so they can land together with the onboarding wizard | 1B                              |

The `role` field and the authorization chain from `ARCHITECTURE_PROPOSAL.md` §4.3
are **not** in 1A either, because they live on family membership, which does not
exist yet. 1A stops at _authentication_ — proving who you are. _Authorization_ —
what you may touch — arrives with families in 1B, as agreed.

---

## 2. What Phase 0 already gives us

Nothing here changes; 1A plugs into it.

| Exists                                                                             | Used by 1A for                     |
| ---------------------------------------------------------------------------------- | ---------------------------------- |
| `config/env.ts` — Zod-validated env, sole reader of `process.env`                  | New secrets and TTLs go through it |
| `lib/httpError.ts` — `HttpError` + `unauthorized()`, `conflict()`, …               | Every auth failure                 |
| `middleware/errorHandler.ts` — `{ error: { code, message, details } }`             | Auth errors need no new shape      |
| `middleware/validate.ts` — Zod at the boundary                                     | Register/login bodies              |
| `packages/shared` — constants (`LOCALES`, `DEFAULT_UNITS`, …), `Id`, `IsoDateTime` | Auth DTOs and schemas              |
| `db/connect.ts`, `app.ts`, `routes.ts`                                             | Mount point for the auth router    |

---

## 3. New dependencies — four decisions to approve

All four are genuinely needed; I have kept the count as low as I can and noted
the zero-dependency alternative in each case.

### D17 — Password hashing: `node:crypto` scrypt (recommended) vs `argon2`

**Recommendation: scrypt from Node's built-in `crypto`. No dependency.**

OWASP's Password Storage Cheat Sheet names Argon2id first choice and lists
**scrypt as an acceptable alternative when Argon2id is not available**, with
parameter sets including `N=2^16, r=8, p=2` (64 MiB) as equal in security to
`N=2^17, r=8, p=1`. Node ships scrypt in `node:crypto`, so we get a memory-hard,
OWASP-sanctioned KDF for zero dependencies and no native build step.

The alternative, `argon2@0.45.1`, is a native module: it needs prebuilt binaries
or a compiler, and it is the kind of dependency that breaks on a Node upgrade at
the worst moment. For a solo project that friction is real and recurring.

Chosen parameters: `N = 2^16, r = 8, p = 2`, 16-byte random salt, 64-byte
derived key, `maxmem` raised to fit. Hashes are stored **with their parameters
encoded in the string**:

```text
scrypt$16384$8$2$<base64 salt>$<base64 hash>
```

so the cost can be raised later and old hashes upgraded transparently on next
login, rather than being stranded.

Say the word if you would rather have OWASP's first choice and accept the native
dependency; the `lib/password.ts` interface is identical either way, so this is
the one decision here that stays cheap to reverse.

### D18 — Access tokens: `jose@6.2.10`

**Recommendation: add it.** `jose` has **zero dependencies**, is ESM-native and
actively maintained, and verifies with an explicit algorithm allowlist — which
is exactly the defence against the `alg: none` and algorithm-confusion classes of
JWT bug. Hand-rolling an HMAC token over `node:crypto` is about forty lines, but
they are forty lines of security-critical code with well-known footguns, and JWT
is worth knowing properly. `jsonwebtoken@9.0.3` is the older CommonJS
alternative; `jose` is the better fit for our ESM setup.

### D19 — Cookie parsing: `cookie-parser@1.4.7`

**Recommendation: add it.** Express 5 does not parse cookies. We need exactly
one cookie, but hand-splitting `req.headers.cookie` mishandles quoting and
encoding, which is a classic source of subtle bugs. `cookie-parser` is
Express-team maintained with two tiny dependencies. We will **not** use signed
cookies — the refresh token is already a 256-bit random value verified against a
server-side hash, so a cookie signature would add a second secret and no
security.

### D20 — Login rate limiting: `express-rate-limit@8.7.0`

**Recommendation: add it.** Brute-force protection on login is exactly the
"production-quality security where it matters" case. Hand-rolled limiters are a
known source of off-by-one and memory-leak bugs. Its in-memory store is
per-process, which is correct for a single instance; if we ever run more than
one, we swap in a store rather than rewrite the logic. Behind a proxy it needs
`app.set('trust proxy', …)` — a deployment-time detail that belongs with D16.

Also arriving now, deferred from Phase 0 by prior agreement:
**`mongodb-memory-server@11.2.0`** (dev only) — the first DB-backed tests need it.

---

## 4. The authentication flows

Token model, per decision D6:

|              | Access token                              | Refresh token                                             |
| ------------ | ----------------------------------------- | --------------------------------------------------------- |
| Format       | JWT, HS256                                | Opaque, 256 bits of `crypto.randomBytes`                  |
| Lifetime     | **15 minutes**                            | **30 days**, reset on each rotation                       |
| Transport    | `Authorization: Bearer …`                 | httpOnly cookie                                           |
| Stored where | Client memory only — never `localStorage` | Cookie on the client; **SHA-256 hash only** on the server |
| Revocable    | No (short life is the mitigation)         | Yes, immediately                                          |
| Claims       | `sub`, `iat`, `exp`, `typ: 'access'`      | none — it carries no data                                 |

A refresh token is deliberately **not** a JWT. It must be revocable, so it has to
be looked up server-side anyway; making it opaque means a leaked token reveals
nothing and cannot be forged if the JWT secret leaks.

### 4.1 Registration

```text
POST /auth/register  { email, password, displayName, locale?, timezone? }

validate body (Zod, shared schema)
  → normalise email: trim + lowercase
  → is the email taken?          yes → 409 EMAIL_TAKEN
  → hash password (scrypt)
  → create user with defaults: locale, timezone, DEFAULT_UNITS
  → start a session: new sessionId, issue refresh token, store its hash
  → issue access token
  → 201 { user, accessToken, expiresIn }  + Set-Cookie: refresh_token
```

Registration signs you straight in — one less step for a parent holding a baby.

### 4.2 Login

```text
POST /auth/login  { email, password }

validate body
  → find user by normalised email (explicitly selecting passwordHash)
  → NOT FOUND: still run a scrypt verification against a fixed dummy hash,
                then fail — so the response time does not reveal whether the
                account exists
  → verify password (timing-safe comparison)
  → wrong: 401 INVALID_CREDENTIALS  (identical body to the not-found case)
  → if the stored hash used weaker parameters than current: re-hash and save
  → start a new session (new sessionId), issue refresh + access tokens
  → record lastLoginAt
  → 200 { user, accessToken, expiresIn } + Set-Cookie
```

Rate limited: 10 attempts per 15 minutes per IP, and separately per email, then
429 `TOO_MANY_ATTEMPTS`.

### 4.3 Refresh, with rotation and reuse detection

This is the part worth getting right, so it is spelled out.

```text
POST /auth/refresh        (no body; the cookie is the credential)

read refresh_token cookie          missing → 401 UNAUTHORIZED
  → hash it (SHA-256) and look the hash up

  ├─ no such token            → 401 UNAUTHORIZED
  ├─ expired                  → 401 TOKEN_EXPIRED
  ├─ ALREADY REVOKED          → REUSE DETECTED:
  │                             revoke every token in that sessionId,
  │                             reason 'reuse_detected', clear the cookie,
  │                             log a warning, 401 UNAUTHORIZED
  └─ valid
       → revoke the presented token   (reason 'rotated', rotatedAt = now)
       → issue a new refresh token in the SAME sessionId
       → link: old.replacedByHash = new hash
       → issue a new access token
       → 200 { accessToken, expiresIn } + Set-Cookie (the new one)
```

Why reuse detection matters: rotation alone does not help if a token is stolen —
the thief simply uses it. But then either the thief or the real user presents an
already-rotated token, and that is the signal. Killing the whole `sessionId`
lineage at that moment turns a silent compromise into a single forced re-login.

**Naming, to avoid a collision that would cause real confusion later:** the field
tying one login's tokens together is `sessionId`, **not** `familyId`. `familyId`
already means a Baby Tracker family everywhere else in this codebase.

### 4.4 Logout

```text
POST /auth/logout

read the cookie (if any) → revoke that token and its whole sessionId,
                            reason 'logout'
clear the cookie (same name, path, attributes — otherwise browsers ignore it)
204 No Content
```

Always 204, even with no cookie or an unknown one: logging out is idempotent and
must never leak whether a token was real. Revocation is server-side — clearing
the cookie alone would leave a working token in an attacker's hands.

### 4.5 `GET /auth/me`

```text
GET /auth/me      Authorization: Bearer <access token>

authenticate middleware → req.auth = { userId }
  → load the user            gone → 401 UNAUTHORIZED
  → 200 { user }
```

`ARCHITECTURE_PROPOSAL.md` §6 describes `/auth/me` as returning "user + families

- babies" for app bootstrap. In 1A it returns the user alone, and grows in 1B and
  1C as those resources appear. That is phasing, not a change of contract.

### 4.6 The `authenticate` middleware

```text
Authorization header absent or not "Bearer …"  → 401 UNAUTHORIZED
verify JWT with an explicit HS256-only allowlist
  ├─ bad signature / malformed  → 401 UNAUTHORIZED
  ├─ expired                    → 401 TOKEN_EXPIRED   (client should refresh)
  └─ typ !== 'access'           → 401 UNAUTHORIZED
sub is not a valid ObjectId                     → 401 UNAUTHORIZED
req.auth = { userId }
```

`TOKEN_EXPIRED` is a distinct code on purpose: the web client uses it as the
signal to call `/auth/refresh` once and retry, rather than dumping the user on
the login screen.

The middleware sets `req.auth` and nothing else. It performs **no** database
read — that is the entire point of a stateless access token, and it keeps every
future request cheap.

---

## 5. Where each responsibility lives

The rule: **every layer may only talk to the one below it**, and only the service
layer knows the business rules.

| Layer          | File                                                                             | Owns                                                                                                                               | Must never                                                                            |
| -------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **shared**     | `packages/shared/src/schemas/auth.ts`, `types/auth.ts`                           | Zod schemas for register/login; `PublicUser`, `AuthResponse`, `RefreshResponse` DTOs                                               | Contain secrets, Node-only imports or server logic — the browser imports this package |
| **route**      | `features/auth/routes.ts`                                                        | Paths, HTTP verbs, middleware order                                                                                                | Contain logic of any kind                                                             |
| **validation** | `middleware/validate.ts` (exists) + shared schemas                               | Rejecting malformed input before it reaches a controller                                                                           | Duplicate schemas — they come from `shared`                                           |
| **controller** | `features/auth/controller.ts`                                                    | HTTP ↔ service translation: read `req.body`/`req.auth`, call one service function, set or clear the cookie, choose the status code | Touch Mongoose, hash anything, or make decisions                                      |
| **service**    | `features/auth/service.ts`                                                       | All of it: uniqueness, credential verification, session creation, rotation, reuse detection, revocation. Throws `HttpError`        | Know about `req`, `res`, cookies or headers                                           |
| **model**      | `models/User.ts`, `models/RefreshToken.ts`                                       | Schema, indexes, `toJSON` transform                                                                                                | Hold business logic or perform side effects                                           |
| **middleware** | `middleware/authenticate.ts`, `middleware/rateLimit.ts`                          | Establishing `req.auth`; throttling                                                                                                | Perform a DB read (`authenticate` is stateless by design)                             |
| **lib**        | `lib/password.ts`, `lib/accessToken.ts`, `lib/refreshToken.ts`, `lib/cookies.ts` | Pure, testable primitives: hash/verify, sign/verify, generate/hash, cookie attributes                                              | Import models or services — these are leaves                                          |

Two small conventions worth naming:

- **`toPublicUser`** lives in `features/auth/mappers.ts` and is the only function
  that turns a `UserDocument` into the wire DTO. One place to forget to strip
  `passwordHash` is better than five.
- **`req.auth`** is added by TypeScript module augmentation in
  `apps/api/src/types/express.d.ts`, typed as optional, with a `getAuth(req)`
  accessor that throws `unauthorized()` if it is missing. This is a small
  addition to the Phase 0 pattern (which put parsed query/params on
  `res.locals`); `req.auth` reads far better at call sites and the accessor keeps
  it type-safe rather than littering handlers with `!`.

---

## 6. MongoDB models

### 6.1 `users`

```ts
{
  email:        string;   // required, unique, lowercase, trimmed
  passwordHash: string;   // required, select: false
  displayName:  string;   // required, 1–80 chars
  locale:       'ru' | 'en';                    // default DEFAULT_LOCALE
  timezone:     string;                         // IANA, default 'Asia/Yerevan'
  units: { weight: 'kg'|'lb'; length: 'cm'|'in'; volume: 'ml'|'oz' };
  lastLoginAt?: Date;
  createdAt:    Date;     // timestamps: true
  updatedAt:    Date;
}
```

- Index: `{ email: 1 }` unique.
- `passwordHash` is `select: false`, so it is absent unless a query explicitly
  asks for it. Login is the only place that asks.
- `toJSON`: `_id` → `id`, drop `__v` and `passwordHash`. Belt and braces with
  `toPublicUser`.
- **Not added yet:** `emailVerifiedAt`. Nothing in 1A sets or reads it, and an
  unused field invites the assumption that verification exists. It arrives with
  the verification flow.

### 6.2 `refresh_tokens`

```ts
{
  userId:          ObjectId;  // ref User, required
  sessionId:       string;    // uuid — one login, stable across rotations
  tokenHash:       string;    // sha256 hex of the opaque token, required, unique
  expiresAt:       Date;      // required
  rotatedAt?:      Date;
  revokedAt?:      Date;
  revokedReason?:  'rotated' | 'logout' | 'reuse_detected' | 'password_changed';
  replacedByHash?: string;    // forms the rotation chain
  userAgent?:      string;    // for a future "your devices" screen
  createdAt:       Date;
}
```

- Indexes: `{ tokenHash: 1 }` unique; `{ userId: 1, sessionId: 1 }`;
  `{ expiresAt: 1 }` **TTL, `expireAfterSeconds: 0`** so Mongo reaps expired
  rows without a cron job. Revoked-but-unexpired rows deliberately survive —
  they are what makes reuse detection possible.
- The raw token is **never** stored. A database dump yields no usable session.
- **No IP address.** Spec §37 treats this data as sensitive, and an IP log is
  personal data we have no product use for. `userAgent` is kept because a
  "signed-in devices" screen is a plausible near-term feature; if you would
  rather store neither, say so and I will drop it.

---

## 7. API contracts

All under `/api/v1`. Errors always use the Phase 0 envelope
`{ error: { code, message, details? } }`.

```jsonc
// POST /auth/register    201
// body: { email, password, displayName, locale?, timezone? }
{
  "user": {
    "id": "66f0…",
    "email": "anahit@example.com",
    "displayName": "Anahit",
    "locale": "ru",
    "timezone": "Asia/Yerevan",
    "units": { "weight": "kg", "length": "cm", "volume": "ml" },
    "createdAt": "2026-09-01T10:00:00.000Z",
  },
  "accessToken": "eyJhbGciOiJIUzI1NiJ9…",
  "expiresIn": 900,
}
// + Set-Cookie: refresh_token=…; HttpOnly; SameSite=Lax; Path=/api/v1/auth; Max-Age=2592000
```

```jsonc
// POST /auth/login       200   body: { email, password }   → same shape as register
// POST /auth/refresh     200   no body; cookie is the credential
{ "accessToken": "…", "expiresIn": 900 }
// + Set-Cookie with the rotated token

// POST /auth/logout      204   no body
// + Set-Cookie clearing the cookie

// GET  /auth/me          200   Authorization: Bearer …
{ "user": { … } }
```

Validation rules, defined once in `packages/shared/src/schemas/auth.ts`:

| Field         | Rule                                                                     |
| ------------- | ------------------------------------------------------------------------ |
| `email`       | valid address, ≤ 254 chars, trimmed and lowercased before use            |
| `password`    | **10–128 characters**, no composition rules                              |
| `displayName` | 1–80 characters, trimmed                                                 |
| `locale`      | one of `LOCALES`, default `DEFAULT_LOCALE`                               |
| `timezone`    | non-empty IANA name, validated with `Intl.supportedValuesOf('timeZone')` |

Length over composition follows current guidance: a 10-character minimum with a
128-character ceiling. The ceiling is not cosmetic — an unbounded password is a
denial-of-service vector against a deliberately expensive KDF.

Error codes 1A introduces:

| Code                  | Status | When                                                     |
| --------------------- | ------ | -------------------------------------------------------- |
| `VALIDATION_FAILED`   | 422    | Zod rejected the body (existing handler)                 |
| `EMAIL_TAKEN`         | 409    | Registration with an existing email                      |
| `INVALID_CREDENTIALS` | 401    | Wrong password **or** unknown email — identical response |
| `UNAUTHORIZED`        | 401    | Missing/invalid/revoked token                            |
| `TOKEN_EXPIRED`       | 401    | Access or refresh token past its expiry                  |
| `TOO_MANY_ATTEMPTS`   | 429    | Rate limit tripped                                       |

One deliberate trade-off to flag: `EMAIL_TAKEN` on registration confirms that an
address has an account, which is a user-enumeration vector. The alternative —
always returning success and sending an email instead — needs the email provider
we have deferred, and would make registration confusing in the meantime. I
recommend accepting it, mitigated by the rate limit, and revisiting when
verification emails land. Login deliberately does **not** leak this.

---

## 8. Security rules

1. Passwords are never logged, never returned, never in an error message, and
   `select: false` on the model.
2. Hashing is memory-hard, per-password random salt, parameters stored with the
   hash, verification via `crypto.timingSafeEqual`.
3. Login runs a dummy verification when the email is unknown, so response timing
   does not reveal account existence, and returns a byte-identical body.
4. Access tokens are verified with an **explicit algorithm allowlist** and a
   `typ` claim check, so a refresh token or a token signed with `alg: none` can
   never be accepted as an access token.
5. Refresh tokens are opaque 256-bit random values, stored only as SHA-256
   hashes, transported only in an httpOnly cookie.
6. The cookie is `HttpOnly`, `Secure` in production, `SameSite=Lax`, and scoped
   to `Path=/api/v1/auth` so it is not sent with ordinary API calls.
7. Every refresh rotates. The presented token is revoked in the same operation
   that issues its replacement.
8. Reuse of a revoked token revokes the entire session lineage.
9. Logout revokes server-side; clearing the cookie is not the mechanism.
10. `authenticate` derives identity **only** from the verified token. No
    endpoint ever accepts a `userId` from a body, query or path — the rule that
    `ARCHITECTURE_PROPOSAL.md` §4.3 extends to families in 1B.
11. `JWT_SECRET` is required by `env.ts` with a 32-character minimum; the API
    refuses to start without it, in every environment.
12. CORS keeps `credentials: true` with an explicit origin — never `*`. With
    `SameSite=Lax` and a cookie scoped to the auth path, a cross-site POST to
    `/auth/refresh` does not carry the cookie, so no CSRF token is needed. **If
    D16 puts the web app on a different origin from the API**, the cookie must
    become `SameSite=None; Secure`, and then CSRF protection becomes mandatory.
    Noting it now so the choice is made deliberately, not discovered.
13. Rate limits on `/auth/login`, `/auth/register` and `/auth/refresh`.
14. When password change arrives, it revokes every session for that user —
    `revokedReason: 'password_changed'` exists for it.

---

## 9. Tests that must exist before 1A is done

Following D15: Vitest + Supertest + `mongodb-memory-server`, with the security
properties tested as properties, not as implementation details.

**Unit — `lib/password.test.ts`**

- hash then verify succeeds; a wrong password fails
- the same password hashed twice yields different strings (salting)
- a hash string carries its parameters and can be parsed back
- a hash written with weaker parameters is detected as needing an upgrade
- a malformed hash string is rejected rather than throwing

**Unit — `lib/accessToken.test.ts`**

- sign then verify returns the `sub`
- a token signed with a different secret is rejected
- an expired token is rejected with `TOKEN_EXPIRED`
- a token whose `typ` is not `access` is rejected
- a token with a tampered payload is rejected

**Integration — `features/auth/auth.test.ts`**

- register: 201, correct body, `Set-Cookie` present with `HttpOnly` and the
  scoped `Path`, email persisted lowercase, user retrievable
- register with an existing email → 409 `EMAIL_TAKEN`
- register with a short password / bad email → 422 with `details`
- login: 200 and a cookie; wrong password → 401 `INVALID_CREDENTIALS`;
  **unknown email → the same status, code and body**
- refresh: returns a new access token **and a different refresh cookie**; the
  old refresh token then fails
- **reuse detection: presenting a rotated token fails AND invalidates the newest
  token of that session** — the property that makes rotation worth having
- two independent logins create two sessions; logging out of one leaves the
  other working
- logout: 204, cookie cleared, token unusable afterwards; logging out twice is
  still 204
- rate limit: repeated failed logins eventually return 429

**Integration — `middleware/authenticate.test.ts`**

- no header → 401; malformed header → 401; garbage token → 401
- expired access token → 401 `TOKEN_EXPIRED`
- **a refresh token used as a Bearer token → 401**
- valid token → 200 and the right user
- a token for a user that has since been deleted → 401

**Cross-cutting guard**

- a test asserting that `passwordHash` appears in **no** response body of any
  auth endpoint — a cheap regression net for the leak that matters most.

---

## 10. Exact files

### Create — `packages/shared` (2)

```text
packages/shared/src/schemas/auth.ts     registerSchema, loginSchema (Zod)
packages/shared/src/types/auth.ts       PublicUser, AuthResponse, RefreshResponse
```

### Create — `apps/api` (14)

```text
src/models/User.ts
src/models/RefreshToken.ts

src/lib/password.ts                     scrypt hash / verify / needsUpgrade
src/lib/accessToken.ts                  sign / verify (jose, HS256, typ check)
src/lib/refreshToken.ts                 generate opaque token, sha256 hash
src/lib/cookies.ts                      set / clear the refresh cookie, one place
src/types/express.d.ts                  req.auth augmentation

src/middleware/authenticate.ts          + getAuth(req)
src/middleware/rateLimit.ts             authLimiter, loginLimiter

src/features/auth/routes.ts
src/features/auth/controller.ts
src/features/auth/service.ts
src/features/auth/mappers.ts            toPublicUser

src/test/setup.ts                       in-memory Mongo lifecycle, test env vars
```

### Create — tests (4)

```text
apps/api/src/lib/password.test.ts
apps/api/src/lib/accessToken.test.ts
apps/api/src/features/auth/auth.test.ts
apps/api/src/middleware/authenticate.test.ts
```

### Modify (8)

```text
packages/shared/src/index.ts       export the new schemas and types
apps/api/src/config/env.ts         + JWT_SECRET (min 32, required),
                                     ACCESS_TOKEN_TTL_SECONDS (default 900),
                                     REFRESH_TOKEN_TTL_DAYS (default 30),
                                     COOKIE_SECURE, COOKIE_SAMESITE
apps/api/src/app.ts                + cookieParser()
apps/api/src/routes.ts             mount authRouter
apps/api/package.json              + jose, cookie-parser, express-rate-limit,
                                     @types/cookie-parser, mongodb-memory-server
apps/api/.env.example              document the new variables
vitest.config.ts                   api project gains globalSetup + setupFiles
README.md                          new environment variables
CLAUDE_PROGRESS.md                 phase status, decisions D17–D20
```

**Nothing in `apps/web` changes in 1A.** No Phase 0 architectural decision is
altered; `req.auth` (§5) is the only new convention, and it is additive.

One Phase 0 consequence to note: making `JWT_SECRET` required means the existing
`health.test.ts` needs the test environment that `src/test/setup.ts` provides.
That is why the vitest api project gains setup files, and why `health.test.ts`
will show as touched by configuration even though its own code does not change.

### Suggested commit split

Three reviewable commits rather than one:

1. **`1A.1`** — models, `lib/*` primitives, test setup, unit tests. No routes.
2. **`1A.2`** — service, controller, routes, cookies, rate limiting; integration
   tests for register / login / refresh / rotation / reuse / logout.
3. **`1A.3`** — `authenticate` middleware, `GET /auth/me`, middleware tests.

Each leaves the app running and `npm run verify` green.

---

## 11. What I need from you

1. Approve or amend **D17** (scrypt vs argon2), **D18** (`jose`), **D19**
   (`cookie-parser`), **D20** (`express-rate-limit`).
2. Confirm the token lifetimes: access **15 minutes**, refresh **30 days**. A
   parent should not be logged out mid-night-feed; if you want an absolute
   session cap (say 90 days regardless of rotation), say so now — it is cheap
   today and awkward later.
3. Confirm the registration enumeration trade-off in §7.
4. Confirm `userAgent` storage in §6.2 — keep it, or store nothing.
5. Confirm the scope boundary: password reset and email verification wait for an
   email-provider decision; the login UI arrives with 1B.
