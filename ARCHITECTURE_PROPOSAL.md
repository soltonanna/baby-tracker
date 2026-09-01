# Baby Tracker — Architecture & Roadmap Proposal

Status: **proposal, awaiting approval. No code written yet.**
Date: 2026-09-01
Source of truth: `BABY_TRACKER_SPEC.md`

---

## 1. Product understanding

Baby Tracker is a **private family journal for raising babies, designed for twins from the first line of code**.

The product exists to remove memory load from a tired parent. Its value is not "a feeding log" — it is:

> fast logging → reliable history → per-child medical & developmental record → visible dynamics.

Non-negotiable product properties, as I read the spec:

| Property | What it means in practice |
|---|---|
| **Twin-first** | Two children are the default case, not a setting. Every event, growth record, medical entry, vaccination, appointment, medication and milestone belongs to a *specific* child. An action may be logged *for both at once*, but the stored data stays per child and must never blend. |
| **Fast** | The primary action (log a feeding / sleep / diaper) is 1–3 taps, one-handed, on a phone, possibly at 3am in the dark. Forms are pre-filled with sensible defaults; nothing is mandatory that can be inferred. |
| **Reliable** | History is never silently lost or changed. Soft delete, audit fields, timestamps preserved. |
| **Non-medical** | The app stores and displays what a parent or doctor entered. It never diagnoses, never recommends or computes a dose, never says a baby is healthy/unhealthy, never compares Baby A to Baby B qualitatively. Statistics and neutral observations only. |
| **Private** | Children's medical data. Family-scoped authorization on every single read and write; documents are never public URLs; sharing is explicit opt-in and scoped. |
| **Mobile-first** | Bottom navigation, FAB, large touch targets, minimum typing. Desktop supported but secondary. |

MVP scope (spec §33): auth, one family with two babies, daily tracker (feeding / sleep / diapers / notes), growth (weight, height), medical basics (doctors, appointments, vaccinations), dashboard with today's summary, and Twin Mode (A / B / Both).

Explicitly out of scope for now (spec §36): community, public profiles, marketplace, medical decision support, automatic diagnosis, heavy AI, many integrations.

---

## 2. Current project structure & technology stack

The repository is, as of today, **empty apart from the specification**:

```text
baby-tracker/
└── BABY_TRACKER_SPEC.md      (1279 lines)
```

Findings:

* No `package.json`, no source code, no configuration, no tests.
* **Not a git repository** (`git rev-parse` fails) — there is no version control yet.
* No `.gitignore`, no `.editorconfig`, no `README.md`, no CI.
* Local Node toolchain visible to me: **Node v22.23.2, npm 10.9.8**. I could not see `pnpm`, `yarn`, `docker` or a MongoDB client from my sandboxed view of your machine — that view is limited, so please confirm what you actually have installed (especially Docker and/or a MongoDB Atlas account).

There is therefore **no existing code that could conflict with the spec**. Section 12 below lists the ambiguities I found *inside* the spec itself, which I am flagging rather than silently resolving.

---

## 3. What exists / what is missing

**Exists**

* A detailed, well-structured product specification.
* Project instructions defining working method, stack, safety and UX rules.

**Missing — everything else.** Grouped by the order it will be needed:

| Area | Missing |
|---|---|
| Repo hygiene | git init, `.gitignore`, `.editorconfig`, `.nvmrc`, `README.md`, license/privacy note |
| Tooling | TypeScript config, ESLint, Prettier, Vitest, env handling, local MongoDB (docker-compose or Atlas), npm workspaces |
| Shared layer | Domain types, validation schemas, unit conversion, date/time helpers |
| Backend | HTTP app, config, DB connection, models, auth, authorization, all domain features, error handling, tests |
| Frontend | Vite app, routing, API client, auth flow, layout/navigation, i18n, all feature UIs |
| Ops | Environment configuration, build scripts, deployment target, backups |

---

## 4. Proposed target architecture

### 4.1 Repository shape — npm workspaces monorepo

```text
baby-tracker/
├── package.json                 # workspaces root, scripts
├── tsconfig.base.json
├── docker-compose.yml           # local MongoDB (optional)
├── BABY_TRACKER_SPEC.md
├── ARCHITECTURE_PROPOSAL.md
├── packages/
│   └── shared/                  # types + zod schemas + units + time helpers
└── apps/
    ├── api/                     # Node + TypeScript + Express + Mongoose
    └── web/                     # React + TypeScript + Vite
```

Why a monorepo: the frontend and backend must agree exactly on ~15 domain types and their validation rules. One `packages/shared` means the request body the client builds and the schema the server validates are **literally the same object** — the strongest possible guarantee against drift, and it costs one config file. No publishing, no Lerna/Nx/Turborepo needed at this size.

### 4.2 Backend layering

```text
request
  → route            (path + middleware wiring)
  → validate         (zod schema from packages/shared)
  → authenticate     (access token → req.user)
  → authorize        (family membership + role + baby ownership)
  → controller       (HTTP in / HTTP out only, no logic)
  → service          (business logic, pure where possible)
  → model            (Mongoose, the only place that talks to Mongo)
```

Feature-oriented folders, not layer-oriented:

```text
apps/api/src/
├── index.ts                    # process bootstrap
├── app.ts                      # express app assembly
├── config/env.ts               # typed, validated environment
├── db/connect.ts
├── lib/                        # httpError, logger, pagination, ids
├── middleware/                 # authenticate, authorize, validate, error, rateLimit
├── models/                     # mongoose schemas & typed models
└── features/
    ├── auth/  { routes.ts, controller.ts, service.ts, schemas.ts, *.test.ts }
    ├── users/  families/  babies/
    ├── events/                 # ONE domain for all event types
    ├── growth/  medical/  vaccinations/  appointments/
    ├── medications/  milestones/  documents/  notifications/
    ├── summary/  analytics/
    └── ai/                     # v3
```

Per spec §28, there is **no separate backend domain per event type**. `feeding`, `sleep`, `diaper`, `bath`, `temperature`, `medication`, `pumping`, `bottle`, `note` are variants of one `events` domain, distinguished by a discriminated union in the `data` field. Adding a new event type = add a union member + a form component. Nothing else changes.

### 4.3 Authorization model — the single most important backend rule

```text
The client NEVER supplies familyId as a trust anchor.
```

Concretely:

1. `authenticate` resolves `req.user` from the access token only.
2. For a `/families/:familyId/...` route, `loadMembership` looks up `family_members { familyId, userId: req.user.id, status: 'active' }`. No membership → **404** (not 403 — we do not confirm that a family id exists).
3. For a `/babies/:babyId/...` or `/events/:eventId` route, the resource is loaded first, its `familyId` is read **from the document**, and membership is then checked against that.
4. Every service-layer query carries `familyId` in its filter. This is enforced by making the service functions take a `scope: { familyId, userId, role }` argument as their first parameter — a function that cannot be called without a scope cannot leak another family's data.
5. `requireRole('owner' | 'parent')` guards family settings, baby creation/deletion, invites and medical edits; `caregiver` may create/edit daily events only.

I will write authorization tests (family A cannot read/patch/delete family B's baby, event, growth record, document) as part of the same phase as each feature, not afterwards.

### 4.4 Frontend architecture

* **React 19 + TypeScript + Vite**, React Router for routing.
* **Server state via TanStack Query** (caching, refetch, optimistic updates, retry). This replaces most of what people use Redux for; global client state stays tiny: auth session + user settings (units, locale) + selected baby filter, in two small contexts.
* **Feature-based folders** exactly as spec §30.
* **i18n from day one** with `i18next` + `react-i18next`, locales `ru` and `en`. Retrofitting i18n is expensive; wiring it up front is nearly free.
* **Mobile-first layout**: app shell with bottom navigation (Today / Timeline / Health / More), a floating action button that opens a bottom sheet of event types, and a persistent "active sleep" banner when a sleep session is running.
* Units are converted **only at the display/input edge** via `packages/shared/units` — never in components ad hoc.

### 4.5 Cross-cutting conventions

* All timestamps stored **UTC**; all display in the family's timezone.
* All measurements stored in **canonical base units**: grams, millimetres, millilitres, seconds, °C. User units are a display preference (spec §26).
* Soft delete (`deletedAt`) on every baby-owned record; `createdBy` / `updatedBy` on everything a human writes.
* Errors: `{ error: { code, message, details? } }`, HTTP status carries the class. One error middleware, one `HttpError` class.
* Pagination: cursor-based (`startAt` + `_id`) for events and timeline; page-based nowhere.

---

## 5. Proposed MongoDB data model

Collections (spec §29), with the fields I propose. `_id` is an ObjectId everywhere; `createdAt`/`updatedAt` are on every document.

### 5.1 `users`

```ts
{
  email: string;            // unique, lowercased
  passwordHash: string;
  displayName: string;
  locale: 'ru' | 'en';
  timezone: string;                       // IANA, e.g. 'Asia/Yerevan'
  units: { weight: 'kg'|'lb'; length: 'cm'|'in'; volume: 'ml'|'oz' };
  emailVerifiedAt?: Date;
  lastLoginAt?: Date;
}
```
Index: `{ email: 1 } unique`.

### 5.2 `families`

```ts
{ name: string; ownerId: ObjectId; timezone: string; }
```
The family carries a timezone too: the "day boundary" for daily summaries is a family-level fact, not a per-viewer one.

### 5.3 `family_members`

```ts
{ familyId: ObjectId; userId: ObjectId;
  role: 'owner'|'parent'|'caregiver';
  status: 'active'|'invited'|'revoked';
  invitedBy?: ObjectId; invitedEmail?: string; inviteTokenHash?: string;
  joinedAt?: Date; }
```
Indexes: `{ userId: 1, status: 1 }`, `{ familyId: 1, userId: 1 } unique`, `{ inviteTokenHash: 1 } sparse`.

A separate collection rather than an array embedded in `families`, because the hottest query in the whole system — "may this user touch this family?" — is then a single indexed lookup, and invitations of not-yet-registered users have a natural home.

### 5.4 `babies`

```ts
{
  familyId: ObjectId;
  name: string;                 // 'Baby A' initially, renameable
  displayOrder: number;         // 0, 1 → stable A/B ordering in the UI
  sex: 'male'|'female'|'unspecified';
  color?: string; emoji?: string;         // instant visual identity in a 3am UI
  birthDate: Date; birthTime?: string; birthPlace?: string;
  birth: { weightGrams?: number; lengthMm?: number; headCircumferenceMm?: number };
  gestationalAge?: { weeks: number; days: number };
  bloodType?: string;
  photoDocumentId?: ObjectId;
  notes?: string;
  deletedAt?: Date;
}
```
Index: `{ familyId: 1, deletedAt: 1, displayOrder: 1 }`.

### 5.5 `events` — the core collection

```ts
{
  familyId: ObjectId;
  babyId: ObjectId;                       // ALWAYS exactly one baby
  groupId?: string;                       // uuid shared by a "both babies" pair
  type: 'feeding'|'sleep'|'diaper'|'bath'|'temperature'
      | 'medication'|'pumping'|'note';
  startAt: Date;                          // UTC
  endAt?: Date | null;                    // null = still running (sleep timer)
  durationSec?: number;                   // derived, stored for cheap aggregation
  localDate: string;                      // 'YYYY-MM-DD' in family timezone
  data: EventData;                        // discriminated union on `type`
  note?: string;
  clientEventId?: string;                 // uuid from the client → idempotency
  createdBy: ObjectId; updatedBy?: ObjectId;
  deletedAt?: Date;
}
```

`data` variants:

```ts
feeding:     { method: 'breast'; side: 'left'|'right'|'both' }
           | { method: 'bottle'; content: 'breast_milk'|'formula'|'other';
               amountMl?: number; bottleType?: string }
sleep:       { period: 'day'|'night'; location?: string }
diaper:      { kind: 'wet'|'dirty'|'wet_and_dirty'|'dry' }
bath:        {}
temperature: { valueC: number; method?: 'axillary'|'ear'|'forehead'|'rectal'|'other' }
medication:  { medicationId?: ObjectId; name: string; doseText: string }
pumping:     { side: 'left'|'right'|'both'; amountMl?: number }
note:        { text: string }
```

Indexes:

```text
{ familyId: 1, babyId: 1, startAt: -1 }                    # timeline per baby
{ familyId: 1, babyId: 1, type: 1, startAt: -1 }           # "last feeding", analytics
{ familyId: 1, localDate: 1, babyId: 1 }                   # daily summary
{ groupId: 1 } sparse                                      # twin pair lookup
{ familyId: 1, clientEventId: 1 } unique sparse            # offline-safe retries
{ familyId: 1, babyId: 1, endAt: 1 } partial(endAt: null)  # running timers
```

**Key decision — how "both babies" is stored.** A "both" action writes **two documents, one per baby, sharing a `groupId`**. Not one document with `babyIds: [a, b]`.

Reasons:
* Spec §5 requires that children's data never mix, and §8 defines an event as having a single `babyId`.
* Every per-baby query, index and aggregation stays trivial and correct. With an array, "Baby A's feedings today" needs `$elemMatch`/`$unwind` on every read path forever.
* Reality diverges immediately: Baby A ate at 10:00, Baby B at 10:05, one finished early. Two documents represent that natively; one document cannot.
* Editing or deleting for one child cannot corrupt the other. `PATCH /events/:id?applyToGroup=true` handles "change both" explicitly, as an opt-in.

The cost is that "both" creation is a two-document write; I will make it a single transaction-free atomic-enough `insertMany` and have the API return both documents.

### 5.6 `growth_records`

```ts
{ familyId, babyId, measuredAt: Date,
  weightGrams?: number, heightMm?: number, headCircumferenceMm?: number,
  source: 'parent'|'doctor', note?: string, createdBy, deletedAt? }
```
Index: `{ familyId: 1, babyId: 1, measuredAt: -1 }`.

### 5.7 `medical_records` (doctor visits)

```ts
{ familyId, babyId, visitDate: Date,
  doctorName: string, clinic?: string,
  specialty: 'pediatrician'|'neurologist'|'orthopedist'|'ophthalmologist'|'dentist'|'other',
  reason?: string, notes?: string, recommendations?: string,
  documentIds: ObjectId[], appointmentId?: ObjectId, createdBy, deletedAt? }
```

### 5.8 `vaccinations`

```ts
{ familyId, babyId,
  vaccineCode?: string, vaccineName: string, doseNumber?: number,
  status: 'planned'|'done'|'skipped',
  administeredAt?: Date, plannedFor?: Date,
  clinic?: string, doctorName?: string, batchNumber?: string,
  notes?: string, documentIds: ObjectId[], scheduleItemCode?: string, deletedAt? }
```

### 5.9 `vaccination_schedules` (configuration, not business logic — spec §14)

```ts
{ code: 'am_standard'|'ru_standard'|'who', name, locale,
  items: [{ code, name, recommendedAgeDays, doseNumber }] }
```
Seed data. The engine only compares a baby's age in days against `recommendedAgeDays`; no calendar is hardcoded anywhere.

### 5.10 `appointments`

```ts
{ familyId, babyIds: ObjectId[],   // array is CORRECT here: one calendar entry, joint visit
  scheduledAt: Date, durationMin?: number,
  doctorName?: string, specialty?: string, location?: string,
  notes?: string, reminderAt?: Date,
  status: 'scheduled'|'done'|'cancelled', deletedAt? }
```
An appointment is a *calendar entry*, not a child's medical fact — the joint pediatrician visit genuinely is one thing. The medical *record* it produces is per baby (§5.7).

### 5.11 `medications`

```ts
{ familyId, babyId, name: string,
  dosageText: string,      // stored exactly as entered. NEVER computed by the app.
  frequencyText: string,
  startDate: Date, endDate?: Date,
  prescribedBy?: string, notes?: string, active: boolean, deletedAt? }
```

### 5.12 `milestones`

```ts
{ familyId, babyId,
  category: 'motor'|'communication'|'social',
  code: string, customName?: string,
  achievedAt: Date, note?: string, documentIds: ObjectId[], deletedAt? }
```
The milestone catalogue is seed data, per baby, never cross-compared.

### 5.13 `documents`

```ts
{ familyId, babyId?: ObjectId,
  kind: 'ultrasound'|'discharge'|'lab'|'doctor_report'|'vaccination_certificate'|'prescription'|'photo'|'other',
  fileName, mimeType, sizeBytes, storageKey,
  linkedTo?: { type: 'medical_record'|'vaccination'|'appointment'|'baby'|'milestone', id: ObjectId },
  uploadedBy, deletedAt? }
```
Files are **never** served from a public URL. `GET /documents/:id/content` authorizes, then streams.

### 5.14 `notifications`, `refresh_tokens`

```ts
notifications:  { familyId, userId?, type, payload, scheduledFor, sentAt?, readAt? }
refresh_tokens: { userId, tokenHash, expiresAt, userAgent?, revokedAt? }  // TTL index
```

---

## 6. Proposed REST API

Base path `/api/v1`. JSON in, JSON out. Errors: `{ error: { code, message, details? } }`.

### Auth
```text
POST   /auth/register            { email, password, displayName }
POST   /auth/login               → { accessToken, user }  + httpOnly refresh cookie
POST   /auth/refresh             → new access token (rotates refresh token)
POST   /auth/logout
POST   /auth/password/forgot     { email }
POST   /auth/password/reset      { token, password }
GET    /auth/me                  → user + families + babies (app bootstrap)
```

### Users
```text
GET    /users/me
PATCH  /users/me                 { displayName, locale }
PATCH  /users/me/settings        { units, timezone }
```

### Families & members
```text
GET    /families                          → families I belong to
POST   /families                          { name, timezone }
GET    /families/:familyId
PATCH  /families/:familyId                (owner)
GET    /families/:familyId/members
POST   /families/:familyId/invites        { email, role }        (owner)
POST   /invites/:token/accept
PATCH  /families/:familyId/members/:id    { role }               (owner)
DELETE /families/:familyId/members/:id                           (owner)
```

### Babies
```text
GET    /families/:familyId/babies
POST   /families/:familyId/babies         (owner|parent)
GET    /babies/:babyId
PATCH  /babies/:babyId                    (owner|parent)
DELETE /babies/:babyId                    soft delete, confirmation required (owner)
```

### Events — one endpoint for all types
```text
GET    /families/:familyId/events
         ?babyId=&type=&from=&to=&limit=&cursor=          cursor-paginated timeline
GET    /families/:familyId/events/active                  running sleeps/feedings
POST   /families/:familyId/events
         { babyIds: [id] | [idA, idB], type, startAt, endAt?, data, note?, clientEventId }
         → 201 [event] or [eventA, eventB] sharing groupId
GET    /events/:eventId
PATCH  /events/:eventId?applyToGroup=true|false
POST   /events/:eventId/stop              { endAt? }      one-tap "sleep ended"
DELETE /events/:eventId?applyToGroup=...  soft delete
```

### Dashboard & summary
```text
GET    /families/:familyId/dashboard              today per baby + last feeding/sleep/diaper
                                                  + latest growth + next appointment
GET    /families/:familyId/summary/daily?date=YYYY-MM-DD
         → per baby: feedings, sleep total, day/night split, wet/dirty counts
         + twin sync: synchronized feedings, synchronized sleep minutes
```

### Health domains
```text
GET|POST   /babies/:babyId/growth              PATCH|DELETE /growth/:id
GET|POST   /babies/:babyId/medical-records     PATCH|DELETE /medical-records/:id
GET|POST   /babies/:babyId/vaccinations        PATCH|DELETE /vaccinations/:id
GET        /vaccination-schedules              GET /babies/:babyId/vaccinations/plan
GET|POST   /families/:familyId/appointments?babyId=&from=&to=
PATCH|DELETE /appointments/:id
GET|POST   /babies/:babyId/medications         PATCH|DELETE /medications/:id
GET|POST   /babies/:babyId/milestones          PATCH|DELETE /milestones/:id
```

### Documents, analytics, AI
```text
POST   /families/:familyId/documents           multipart, ≤ N MB, mime allowlist
GET    /documents/:id                          metadata
GET    /documents/:id/content                  authorized stream
DELETE /documents/:id

GET    /families/:familyId/analytics/feeding?babyId=&from=&to=
GET    /families/:familyId/analytics/sleep?...
GET    /families/:familyId/analytics/diapers?...
GET    /families/:familyId/analytics/growth?...

POST   /families/:familyId/ai/query            { question }      (v3)
```

Notes on the shape:
* Collection routes are nested under the owner (`/families/:id/...`, `/babies/:id/...`) so the authorization anchor is in the path. Item routes are flat (`/events/:id`) and resolve their family from the document.
* No endpoint accepts `familyId` in a request body.
* Analytics endpoints return **series + counts only**. No verdicts, no thresholds, no "normal/abnormal" flags anywhere in the API surface (spec §7 of the project instructions, §21–22 of the spec).

---

## 7. Proposed frontend structure

```text
apps/web/src/
├── app/
│   ├── App.tsx  router.tsx  providers.tsx
│   └── layout/  AppShell.tsx  BottomNav.tsx  TopBar.tsx  QuickAddFab.tsx
├── components/ui/        Button Sheet Field Select NumberStepper SegmentedControl
│                         Card EmptyState ErrorState Spinner ConfirmDialog Chip
├── features/
│   ├── auth/             LoginPage RegisterPage ForgotPasswordPage useAuth ProtectedRoute
│   ├── onboarding/       CreateFamilyWizard (family → baby A → baby B)
│   ├── babies/           BabyProfilePage BabyForm BabyAvatar useBabies
│   ├── events/           ← shared core for ALL event types
│   │     components/     QuickAddSheet BabyTargetPicker (A / B / BOTH)
│   │                     EventCard EventFormShell TimePicker DurationField
│   │     forms/          FeedingForm SleepForm DiaperForm TemperatureForm NoteForm
│   │     api.ts hooks.ts eventCopy.ts
│   ├── timeline/         TimelinePage DayGroup TwinLane
│   ├── dashboard/        DashboardPage BabyTodayCard LastEventTile TwinSyncCard NextUpCard
│   ├── growth/           GrowthPage GrowthForm GrowthChart MeasurementDelta
│   ├── medical/          MedicalHistoryPage VisitForm VisitCard
│   ├── vaccinations/     VaccinationsPage VaccineChecklist VaccinationForm
│   ├── appointments/     AppointmentsPage AppointmentForm MonthList
│   ├── medications/  milestones/  documents/  analytics/  ai/      (later phases)
│   └── settings/         SettingsPage UnitsSection LanguageSection FamilySection
├── hooks/                useMediaQuery useLocalStorage useNow useHaptics
├── services/             apiClient.ts queryKeys.ts authStorage.ts
├── types/                re-exports from @baby-tracker/shared
├── utils/                units.ts datetime.ts duration.ts format.ts
└── i18n/                 index.ts  locales/ru.json  locales/en.json
```

Rules I will hold myself to: no component over ~150 lines; business logic lives in `hooks.ts`/`utils`, not in JSX; no prop chain deeper than two levels (context or composition instead); every list screen ships loading, empty and error states in the same commit as the happy path.

**The 2-tap path**, concretely: FAB → sheet with 6 large icons → tap `💧` → baby picker `A | B | Both` appears in the same sheet with `Both` pre-selected → tap → saved with `startAt = now` and last-used values, with an undo toast. Feeding and sleep add exactly one screen of optional detail, all pre-filled.

---

## 8. Architectural decisions to make before implementation

These are the choices that are expensive to reverse later. Each has my recommendation; I need your yes/no (or a different call) before Phase 0.

| # | Decision | Options | My recommendation |
|---|---|---|---|
| **D1** | Repository shape | npm workspaces monorepo / two independent folders / two repos | **Monorepo with `packages/shared`.** Shared types+validation is the main defence against FE/BE drift. |
| **D2** | How a "both babies" event is stored | two linked docs (`groupId`) / one doc with `babyIds[]` | **Two linked docs.** Reasoning in §5.5. This is the foundational twin decision — everything else depends on it. |
| **D3** | Units in the database | canonical base units (g, mm, ml, °C, s) / store user's unit alongside value | **Canonical base units**, convert at the UI edge. Aggregation over mixed units is a permanent bug source. |
| **D4** | Day boundary & timezone | family-level timezone + denormalized `localDate` / compute per request | **Family timezone + `localDate` on events.** Makes "today" a single indexed equality match instead of a range computation on every read. |
| **D5** | Sleep crossing midnight | attribute to start day / split across days / overlap-based totals | **List sessions by start day; compute daily sleep totals by overlap with the local day.** Both numbers are then honest. Needs your agreement because it changes what "13h 20m" on the dashboard means. |
| **D6** | Auth token strategy | short access token (memory) + httpOnly refresh cookie w/ rotation / long-lived JWT in localStorage | **Access token in memory + rotating httpOnly refresh cookie.** Children's medical data; localStorage tokens are XSS-exfiltratable. Costs: CORS with credentials, a same-site/domain decision at deploy. |
| **D7** | Validation library | zod / Joi / class-validator | **zod** — schemas live in `packages/shared` and *infer* the TypeScript types, so one definition serves client form validation, server validation and types. (Joi cannot infer types the same way.) |
| **D8** | ODM | Mongoose / native driver | **Mongoose 8** with explicit TS interfaces. Schema-level validation as a second net under zod, and typed models; the native driver would mean hand-writing all of that. |
| **D9** | HTTP framework | Express 5 / Fastify | **Express 5** — smallest learning surface, largest ecosystem, adequate for this load. Fastify is faster but buys nothing we need. |
| **D10** | UI library | Mantine / Tailwind + own components / CSS Modules + own components | Open. **Mantine** if you want speed and you already know it; **Tailwind + a dozen own components** if you want the smallest dependency footprint and full control of the one-handed mobile UI. I lean Mantine for Phase 1–4, since the value here is the product, not the button. |
| **D11** | Chart library | Recharts / visx / hand-rolled SVG | **Recharts** at Phase 4 only, when growth charts arrive. Not before. |
| **D12** | Document storage | local disk / S3-compatible (Cloudflare R2, Backblaze) / Cloudinary | **S3-compatible object storage, private bucket, streamed through the API.** Decide at Phase 7; nothing before then depends on it. |
| **D13** | Offline support | full offline sync now / idempotency hooks now, sync later / ignore for now | **Idempotency hooks now** (`clientEventId` + a single `useCreateEvent` mutation as the only write path), full sync after MVP. Costs ~nothing today, saves a rewrite later. |
| **D14** | Vaccination schedule seed | Armenian / Russian / WHO / none at MVP | Open — please pick. It is pure data either way, and multiple schedules can coexist. |
| **D15** | Testing | Vitest + supertest + `mongodb-memory-server`, tests for services & authorization / manual only | **Vitest + supertest + in-memory Mongo**, with authorization tests mandatory per feature. Not aiming for 100% coverage; aiming for "no family can read another family's data" being provably true. |
| **D16** | Deployment target | Render / Fly.io / VPS + Docker, with MongoDB Atlas | Open — affects env handling and the cookie/domain setup in D6. Can be decided by end of Phase 2, not before. |

---

## 9. Phased MVP development plan

Phases 0–4 constitute the MVP defined in spec §33. After every phase the application runs, is deployable, and nothing previously working is broken.

### Phase 0 — Foundation (size: S)

Goal: an empty but real application — `npm run dev` starts API + web, `/api/v1/health` answers, the web app renders a shell.

```text
git init, .gitignore, .editorconfig, .nvmrc, README.md
package.json (workspaces), tsconfig.base.json, .eslintrc, .prettierrc
docker-compose.yml                          # local mongo (if you use Docker)

packages/shared/
  package.json  tsconfig.json
  src/index.ts
  src/types/{ids,common,user,family,baby,event,growth,medical}.ts
  src/schemas/                              # zod, added per feature as we go
  src/units.ts  src/time.ts  src/constants.ts

apps/api/
  package.json  tsconfig.json  .env.example
  src/index.ts  src/app.ts
  src/config/env.ts                         # zod-validated env
  src/db/connect.ts
  src/lib/{httpError,logger,asyncHandler,pagination}.ts
  src/middleware/{validate,errorHandler,notFound,rateLimit}.ts
  src/features/health/routes.ts
  vitest.config.ts

apps/web/
  package.json  tsconfig.json  vite.config.ts  index.html
  src/main.tsx  src/app/{App,router,providers}.tsx
  src/app/layout/AppShell.tsx
  src/services/apiClient.ts  src/services/queryKeys.ts
  src/i18n/index.ts  src/i18n/locales/{ru,en}.json
  src/styles/{reset.css,theme.css}
```

### Phase 1 — Auth, family, babies, navigation (size: M)

Goal: register → create family → create two babies → see an empty dashboard, on a phone.

Backend
```text
models/{User,Family,FamilyMember,Baby,RefreshToken}.ts
middleware/{authenticate,authorize}.ts        # loadMembership, requireRole, requireBabyAccess
features/auth/{routes,controller,service,schemas,auth.test.ts}.ts
features/users/{routes,controller,service}.ts
features/families/{routes,controller,service,schemas}.ts
features/babies/{routes,controller,service,schemas,babies.authz.test.ts}.ts
lib/password.ts  lib/tokens.ts
```
Frontend
```text
features/auth/{LoginPage,RegisterPage,ForgotPasswordPage,useAuth,AuthProvider,ProtectedRoute}
features/onboarding/CreateFamilyWizard.tsx    # family → Baby A → Baby B
features/babies/{BabyProfilePage,BabyForm,BabyAvatar,useBabies}
app/layout/{AppShell,BottomNav,TopBar}.tsx
components/ui/{Button,Field,Select,Sheet,Card,Spinner,EmptyState,ErrorState}.tsx
```
Done when: a new user can sign up on a phone, land on a shell with bottom navigation, and both babies exist with their birth data.

### Phase 2 — Daily tracker (size: L — the heart of the product)

Goal: log feeding / sleep / diaper / note in 1–3 taps, for A, B or both; see them in a timeline; edit and undo.

Backend
```text
models/Event.ts                               # discriminated data, all indexes from §5.5
features/events/{routes,controller,service,schemas}.ts
features/events/service.ts                    # createEvents (1 or 2 docs + groupId),
                                              # listEvents (cursor), stopEvent, patch, softDelete
features/events/{events.test.ts,events.authz.test.ts,events.group.test.ts}
```
Frontend
```text
features/events/components/{QuickAddSheet,BabyTargetPicker,EventCard,EventFormShell}
features/events/forms/{FeedingForm,SleepForm,DiaperForm,NoteForm}
features/events/{api.ts,hooks.ts}             # useCreateEvent (single write path, clientEventId)
features/timeline/{TimelinePage,DayGroup,TwinLane}
app/layout/QuickAddFab.tsx
components/ui/{SegmentedControl,NumberStepper,TimePicker,ConfirmDialog}.tsx
utils/{duration,datetime}.ts
```
Done when: a diaper for both babies takes two taps; a sleep can be started, shows a running banner, and stopped with one tap; the timeline shows both babies without ever mixing their rows.

### Phase 3 — Twin mode & dashboard (size: M)

Goal: the "Good morning" screen from spec §7, with twin synchronization.

Backend
```text
features/summary/{routes,controller,service}.ts
features/summary/twinSync.ts                  # pure functions: synchronized feedings,
                                              # overlapping sleep minutes  (unit-tested standalone)
features/summary/dashboard.service.ts
```
Frontend
```text
features/dashboard/{DashboardPage,BabyTodayCard,LastEventTile,TwinSyncCard,NextUpCard}
features/dashboard/hooks.ts
```
Done when: the dashboard shows per-baby counts, last feeding/sleep/diaper, twin sync figures, and the next scheduled item — with loading/empty/error states, and no comparative or evaluative wording anywhere.

### Phase 4 — Health: growth, doctors, appointments, vaccinations (size: L) → **MVP complete**

Backend
```text
models/{GrowthRecord,MedicalRecord,Vaccination,Appointment,VaccinationSchedule}.ts
features/growth/{routes,controller,service,schemas}.ts
features/medical/{routes,controller,service,schemas}.ts
features/vaccinations/{routes,controller,service,schemas}.ts
features/appointments/{routes,controller,service,schemas}.ts
db/seeds/vaccinationSchedules.ts              # data only, per D14
```
Frontend
```text
features/growth/{GrowthPage,GrowthForm,GrowthChart,MeasurementDelta}
features/medical/{MedicalHistoryPage,VisitForm,VisitCard}
features/vaccinations/{VaccinationsPage,VaccineChecklist,VaccinationForm}
features/appointments/{AppointmentsPage,AppointmentForm,MonthList}
features/settings/{SettingsPage,UnitsSection,LanguageSection}
```
Done when: both babies have an independent growth curve, visit history and vaccination checklist, and the shared calendar shows upcoming appointments for A, B or both.

### Phase 5 — Analytics & summaries (size: M)
`features/analytics` back and front: feedings/day, average interval, bottle volume, breastfeeding duration, sleep totals and day/night split, diaper counts, growth dynamics. Daily and weekly summary views. Charts only — no interpretation.

### Phase 6 — Family & caregivers (size: M)
Invitations, member management, the `caregiver` role restricted to daily events. The role field and checks already exist from Phase 1; this phase adds the flows and UI.

### Phase 7 — Advanced (size: L, splittable)
Medications, milestones, documents + object storage, notifications/reminders, then offline sync built on the `clientEventId` foundation from D13.

### Phase 8 — AI assistant (size: M–L)
Natural-language queries answered strictly from stored data, daily summaries, neutral observations. Hard guardrails: no diagnosis, no dosing, no treatment advice, refer to a pediatrician for medical questions, and never speak about a baby's health status.

---

## 10. Definition of done (applied per feature, per spec §43)

Backend works · frontend works · data saves · data reloads correctly · zod validation at the boundary · authorization enforced and tested · loading state · empty state · error state · works one-handed on a phone · no obvious race conditions · **one baby's data never appears under the other** · existing features still pass.

---

## 11. Testing strategy

* `packages/shared` — pure unit tests for units, duration, timezone/`localDate`.
* API services — Vitest + `mongodb-memory-server`; twin-sync and summary math tested as pure functions.
* API routes — supertest for happy path, validation failure, and **cross-family access denial on every resource**.
* Web — component tests only where logic is non-trivial (event forms, baby target picker); no chasing coverage numbers.

---

## 12. Ambiguities in the spec (flagged, not resolved)

The repository contains no code, so there are **no code↔spec conflicts to report**. Inside the specification itself I found four points that need your ruling:

1. **§8 vs §5 — event ownership.** §8 defines an event as having a single `babyId`; §5 requires logging one action "for both children at once". These are reconcilable only by choosing a storage strategy — that is decision **D2**, and I recommend two linked documents.
2. **§33 MVP vs §42 roadmap.** §33 puts doctors, appointments and vaccinations in the MVP; §42 puts them in Phase 4, after Twin Mode. I read these as consistent and treat **MVP = Phases 0–4**. Confirm, or cut medical out of the MVP to ship sooner.
3. **§19 caregivers vs §34.** §19 describes the Owner/Parent/Caregiver roles as core, while §34 lists "family caregivers" as v2. My resolution: the `role` field and all authorization checks exist from Phase 1 (retrofitting authorization is dangerous); only the invitation UI waits for Phase 6.
4. **§10 sleep totals.** "Total sleep per 24h" is undefined for a sleep that crosses midnight. That is decision **D5**.

One more note: §26 requires kg/lb, cm/inch, ml/oz. That is a display preference, not a storage format — hence D3. If you would rather store what the user typed, say so now; it changes every aggregation query.

---

## 13. What I need from you before Phase 0

1. Approve or amend §4 (architecture), §5 (data model), §6 (API), §7 (frontend structure).
2. Rulings on **D1–D16**, in particular **D2** (twin storage), **D5** (sleep day boundary), **D10** (UI library) and **D14** (vaccination schedule).
3. Answers to the four ambiguities in §12.
4. Confirmation of your local environment: Docker available? MongoDB Atlas or local? Do you want git initialized in Phase 0?

On approval I will start with Phase 0 only, show you the result, and stop for review before Phase 1.
