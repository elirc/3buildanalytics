# 01 — What this app is and how it is built

Audience: a junior engineer joining this codebase. Assumed background: you can read
TypeScript and React, you have used a REST API before, you have not necessarily used
Prisma, BullMQ, or TanStack Query.

Everything below was verified by reading the source on 2026-07-24. Line references are
`path:line` and are clickable in most editors.

---

## 1. The product in one paragraph

This is an **internal analytics and admin dashboard** — the kind of tool a company
builds for its own staff, not for customers. The system continuously records two kinds
of history: *tracked events* (what users did — signed up, logged in, used a feature,
hit an API error) and *audit events* (what admins did to the system — created a user,
requested an export). It also ingests *monitoring metrics* (API latency, error rate,
queue depth). On top of that history it serves pre-aggregated dashboards to seven
different internal roles, each of which sees a deliberately different slice of the
data, and it lets people pull raw data out as CSV files through a background job
pipeline.

The single most important idea in the codebase: **aggregation happens on the server,
never in the browser.** The frontend asks for `/api/dashboard/events-over-time` and
receives ~30 chart-ready points. It never downloads 10,000 events and groups them in
React. If you ever find yourself writing a `.reduce()` over raw rows in a component,
you are working against the architecture.

### The seven roles

Roles are a Prisma enum (`backend/prisma/schema.prisma:137-145`) and drive everything.

| Role | Rough job | Gets |
| --- | --- | --- |
| `SYSTEM_ADMIN` | Platform owner | Everything, including user management and cache refresh |
| `OPS_MANAGER` | Day-to-day operations | Dashboards, event log, exports |
| `PRODUCT_MANAGER` | Product analytics | Dashboards, event log, funnels, exports |
| `ENGINEERING_ADMIN` | On-call / reliability | Dashboards, monitoring, exports |
| `AUDIT_VIEWER` | Compliance | Dashboards, audit trail, exports |
| `EXECUTIVE_VIEWER` | Leadership | Summary dashboards only |
| `READ_ONLY` | Everyone else | Summary dashboards only |

Seeded logins are `<role_lowercase>@example.com` (e.g. `ops_manager@example.com`),
password `Password123!` for all of them (`backend/prisma/seed.ts:28-40`).

---

## 2. Running it

```bash
cp .env.example .env          # both backend and frontend read from the root .env pattern
docker compose up -d          # postgres:16 on 5432, redis:7 on 6379
npm install                   # npm workspaces — installs backend + frontend together
npm run db:generate           # prisma generate
npm run db:migrate            # applies backend/prisma/migrations/20260519_init
npm run db:seed               # 7 users, 10k tracked events, 1k audit events, 5k metrics
npm run dev                   # backend :4000 and frontend :5173 in parallel
```

Other scripts (all from the repo root, defined in `package.json:9-21`):

```bash
npm run typecheck   # tsc --noEmit for both workspaces; this is also the "lint" script
npm run test        # vitest run in both workspaces
npm run test:e2e    # playwright, frontend only — needs the app already running
npm run build       # tsc build for backend, vite build for frontend
npm run dev:worker -w backend   # the BullMQ export worker as a separate process
```

Things that will trip you up on first run:

- **`node_modules/` is not checked in and is currently absent.** Nothing has been
  installed or run in this working copy. `npm install` first, always.
- **The repo has zero git commits.** `git log` is empty. Your first PR is also the
  repo's first commit — check with your lead how they want that handled.
- **Redis is optional at boot.** `backend/src/server.ts:11-18` catches a Redis
  connection failure and logs `redis.connection.skipped`, then serves anyway. Caching
  silently no-ops (`backend/src/cache/cache.service.ts:6-18` swallows every error) and
  exports fall back to running inline (`exports.service.ts:60-69`). So "it works
  without Redis" is by design — but it also means a broken Redis is invisible.
- **The seeded export jobs point at files that do not exist.** The seed writes
  `fileName: export-N.csv` (`seed.ts:128-142`) but never writes any file to
  `backend/storage/exports/`. Clicking *Download* on a seeded row streams a
  non-existent path. Only exports you create yourself in the running app work.

---

## 3. Repo map

```
buildanalytics/
├── backend/                  # Express API + Prisma + BullMQ worker
│   ├── prisma/
│   │   ├── schema.prisma     # 7 models, 6 enums — the source of truth for the domain
│   │   ├── migrations/       # one migration: 20260519_init
│   │   └── seed.ts           # deletes everything, then generates ~16k rows
│   ├── src/
│   │   ├── app.ts            # builds the Express app (middleware order lives here)
│   │   ├── server.ts         # boots HTTP + optionally the in-process worker
│   │   ├── worker.ts         # boots the worker standalone
│   │   ├── config/env.ts     # zod-validated process.env — the only place env is read
│   │   ├── db/prisma.ts      # the single PrismaClient instance
│   │   ├── cache/            # ioredis client, cache service, cache key builders
│   │   ├── jobs/             # BullMQ queue + processors
│   │   ├── middleware/       # 8 middlewares, see §5
│   │   ├── modules/          # ← the interesting part, see §4
│   │   └── shared/           # errors, permissions matrix, utils (dates, csv, jwt…)
│   └── tests/                # 3 test files total
├── frontend/                 # React 19 + Vite 6 + TanStack Query + Tailwind 4
│   └── src/
│       ├── api/              # one file per backend module — thin fetch wrappers
│       ├── app/              # router.tsx, providers.tsx
│       ├── auth/             # zustand store, login page, route guards
│       ├── components/       # generic UI (DataTable, states, button, card)
│       ├── features/         # feature folders: dashboard, events, audit, exports…
│       ├── layout/           # AppLayout, Header, Sidebar
│       └── lib/              # formatters, queryClient, frontend permission helpers
├── docs/                     # existing guides + the docs/upskill/ curriculum
└── fabledocs/                # you are here
```

Root-level `ARCHITECTURE.md`, `TESTING_GUIDE.md`, etc. are one-line stubs that point
into `docs/`. Ignore them; read `docs/` directly.

---

## 4. Backend: the module pattern

Every backend feature is a folder in `backend/src/modules/<name>/` with the same five
files. Learn this once and you can navigate all seven modules.

```
modules/events/
├── events.routes.ts       # URL → middleware chain → controller. No logic.
├── events.schemas.ts      # zod schemas validating { body, query, params }
├── events.controller.ts   # reads req, calls service, sets status + json. No logic.
├── events.service.ts      # business rules: date parsing, permission shaping, orchestration
└── events.repository.ts   # the only file allowed to touch `prisma.*`
```

The rule the codebase follows: **controllers never import prisma, repositories never
import Express types.** Services are the only layer that knows about both business
rules and multiple repositories.

The modules:

| Module | Mounted at | What it owns |
| --- | --- | --- |
| `auth` | `/api/auth` | register, login, refresh, logout, me |
| `users` | `/api/users` | listing users (that is all it does today) |
| `events` | `/api/events` | tracked events: write one, list, get one, two summaries |
| `audit` | `/api/audit-events` | audit trail: list, get one, three summaries |
| `dashboard` | `/api/dashboard` | 7 read-only aggregate endpoints for charts + KPIs |
| `monitoring` | `/api/monitoring` | metric ingest + 9 read endpoints |
| `exports` | `/api/exports` | CSV job create / list / get / download / retry |
| `dashboardConfigs` | `/api/dashboard-configs` | CRUD for per-role dashboard layouts |

`dashboard` is the one module with extra structure. Its service is a **facade** that
delegates to two sub-services (`dashboard.service.ts:6-13`):

- `kpi.service.ts` — the KPI card numbers, cached, role-filtered
- `chartData.service.ts` — the time-series and funnel shapes

---

## 5. How one request actually flows

Take `GET /api/dashboard/kpi-summary?startDate=2026-06-24&endDate=2026-07-24`.

1. **Global middleware**, in the order set by `app.ts:23-33`:
   `cors` → `helmet` → `express.json` → `cookieParser` → `requestLogger` →
   `rateLimit` → `auth`.
   - `requestLogger.middleware.ts:9-21` assigns `req.requestId` (honouring an inbound
     `x-request-id`), echoes it as a response header, and logs method/path/status/duration
     on `response.on("finish")`. Every error response carries that same `requestId`
     (`error.middleware.ts:18`), so a user-reported ID is enough to find the log line.
   - `rateLimit.middleware.ts:9-32` is an **in-memory `Map` keyed by IP**. Fine for one
     process; wrong for more than one. See US-18.
   - `auth.middleware.ts:5-26` is *non-blocking*: it verifies a `Bearer` token if one is
     present and attaches `req.user`, and calls `next()` either way. It never rejects.
     Authorization is a separate, per-route concern.

2. **Route match**: `dashboardRouter` (`dashboard.routes.ts:12-15`) applies two
   router-level middlewares before any handler:
   - `requirePermission("dashboard:view")` — 401 if `req.user` is missing, 403 if the
     role lacks the permission (`requirePermission.middleware.ts:7-19`).
   - `metricVisibilityMiddleware` — intended to strip `?refresh=true` for non-admins.

3. **Validation**: `validate(dashboardRangeSchema)` parses
   `{ body, query, params }` against a zod object (`validate.middleware.ts:7-27`).
   On failure it converts the first zod issue into an `AppError(BAD_REQUEST, …, 400)`.
   ⚠️ It **parses but discards the result** — it never assigns the coerced values back
   onto the request. So `z.coerce.number()` in `events.schemas.ts:6-7` does not
   actually give the controller a number; the controller does its own `Number(...)`
   conversion at `events.controller.ts:23-24`. Know this before you rely on coercion.

4. **Controller**: `dashboard.controller.ts:6-15` reads raw query strings and calls
   `dashboardService.getKpiSummary({ role: req.user!.role, … })`. Note it passes the
   caller's **role** into the service — the service layer is role-aware by design.

5. **Service** (`kpi.service.ts:9-67`):
   - `parseDateRange(start, end, { maxRangeDays: 365 })` validates the window and
     throws a 400 for bad/inverted/oversized ranges (`shared/utils/dates.ts:11-40`).
     The default cap for raw queries is 180 days; dashboards raise it to 365.
   - Builds a cache key that **includes the role** (`cacheKeys.ts:11-12`) — critical,
     because two roles get different payloads for the same range.
   - Cache hit → return. Cache miss → seven `Promise.all` queries against the repository.
   - `applyMetricVisibility(role, metrics)` **deletes keys** the role must not see
     (`shared/permissions.ts:54-67`). E.g. `EXECUTIVE_VIEWER` loses `adminActions`;
     `READ_ONLY` loses `averageApiLatencyMs`, `backgroundJobFailures`, `adminActions`.
   - `cacheService.set(key, result, 300)` — 5 minute TTL, fire and forget.

6. **Repository** (`dashboard.repository.ts`): a mix of Prisma `count`/`aggregate` and
   hand-written `$queryRaw` where SQL is genuinely better — `date_trunc` bucketing,
   `COUNT(DISTINCT …)`, and `COUNT(*) FILTER (WHERE …)` for the error rate
   (`:38-90`). These are parameterised template tags, not string concatenation.

7. **Error path**: anything thrown inside an async handler is caught by
   `asyncHandler` and forwarded to `errorMiddleware` (`error.middleware.ts:7-35`),
   which renders `AppError`s with their own status/code and everything else as a
   generic 500 (after logging the real error). Clients never see stack traces.

**Response shape.** Success responses are the bare payload. Errors are always
`{ error: { code, message, requestId } }`. The frontend unwraps exactly that shape at
`frontend/src/api/client.ts:22-27`.

---

## 6. Authentication and authorization

There are **three independent layers**. A story that changes access rules usually has
to touch all three, and forgetting one is the classic bug in this repo.

**Layer 1 — is the request authenticated?**
`auth.middleware.ts` attaches `req.user` from the `Authorization: Bearer` header.
`requireAuthenticated.middleware.ts` is the blocking version, used only by `/api/auth/me`.

**Layer 2 — is the role allowed to call this endpoint?**
`requirePermission("<permission>")` on the route, checked against the matrix in
`shared/permissions.ts:13-48`. Eight permissions exist: `users:manage`,
`dashboard:view`, `dashboard:configure`, `events:view`, `audit:view`,
`monitoring:view`, `exports:create`, `exports:view`.

**Layer 3 — which fields of the response can the role see?**
`applyMetricVisibility` in the service. This is *field-level* filtering, and it is the
part people forget. The frontend cooperates by rendering KPI cards conditionally —
`KpiCardGrid.tsx:14-25` only pushes a card if `typeof data.x === "number"`.

**Tokens.** Login returns `{ user, accessToken, refreshToken }`
(`auth.service.ts:192-197`). Access tokens are short-lived (15m default), refresh
tokens are 7d and are stored **hashed** (`sha256`) in the `RefreshToken` table, never
in plaintext. `refresh` implements **rotation**: it finds the stored hash, revokes it,
and issues a brand new pair (`auth.service.ts:121-147`). Logout revokes by hash
(`:149-161`). There is no refresh-token *reuse detection* — replaying a revoked token
just 401s rather than nuking the whole session family.

**On the frontend**, the session lives in a zustand store persisted to localStorage
(`auth/auth.store.ts:29-42`, key `analytics-admin-auth`). `RequireAuth` redirects to
`/login` when there is no user; `RequireRole` redirects to `/` when the role is not in
an allowlist (`auth/RequireRole.tsx:5-13`). Route-level role allowlists are hardcoded
in `app/router.tsx:42-61`, and the sidebar has *its own* copy of the rules in
`lib/permissions.ts`. That is three sources of truth for "who can see what"
(backend matrix, router allowlists, sidebar helpers) and they currently disagree —
US-01 fixes it.

---

## 7. Data model

Seven models in `backend/prisma/schema.prisma`. Everything is a UUID primary key.

- **`User`** — email (unique), bcrypt `passwordHash`, `role`, `isActive`. Relations to
  audit events, export jobs, refresh tokens.
- **`TrackedEvent`** — the product analytics firehose. `eventType` (11-value enum),
  optional `entityType`/`entityId`, `actorId`/`actorEmail`, `sessionId`, `requestId`,
  freeform `metadata` JSON, `occurredAt`. Deliberately **not** a foreign key to `User`
  — analytics rows must survive user deletion and must be cheap to write. Indexed on
  `eventType`, `actorId`, `(entityType, entityId)`, `occurredAt`.
- **`AuditEvent`** — the compliance trail. Unlike `TrackedEvent` it *does* have a real
  `actor` relation, plus `ipAddress`/`userAgent`. Written by `auditService.record()`.
  The distinction matters: tracked events are for product questions, audit events are
  for "who changed this and from where".
- **`MonitoringMetric`** — infrastructure time-series: `metricType` (6-value enum),
  `name`, `value`, `unit`, `tags`, `recordedAt`. Today only the seed writes these.
- **`MetricSnapshot`** — pre-aggregated rollups (`metricKey`, `metricType`, `value`,
  `dimensions`, `periodStart/End`). **Nothing in the application ever writes or reads
  this table.** It is scaffolding for a rollup job that was never built (US-12).
- **`DashboardConfig`** — a named, per-role layout with a `layoutJson` blob and an
  `isDefault` flag. Full CRUD exists; nothing renders from it yet (US-11).
- **`RefreshToken`** — `tokenHash`, `expiresAt`, `revokedAt`.

Seed volumes: 7 users, 10,000 tracked events spread over 90 days, 1,000 audit events,
5,000 monitoring metrics over 30 days, 7 export jobs, 7 dashboard configs. Enough that
a naive query is visibly slow, which is the point.

---

## 8. Caching

`cache/cache.service.ts` is 19 lines: `get<T>` and `set(key, value, ttlSeconds)`, both
wrapped in `try/catch` that returns `null` on any failure. There is **no `del`, no
pattern invalidation, and no cache-hit metric.**

Keys are built centrally in `cache/cacheKeys.ts` and always include the role and the
date range. TTLs: KPI summary 300s, monitoring summary 60s.

Consequences you need to understand before writing a cached endpoint:

- Data can be **up to 5 minutes stale**, and there is no way to bust it when new events
  arrive. The only escape hatch is `?refresh=true`, which
  `metricVisibility.middleware.ts:8` tries to restrict to `SYSTEM_ADMIN`.
- That middleware works by **mutating `request.query`**. In Express 5 `req.query` is a
  getter that re-parses the query string, so whether that assignment survives to the
  controller is version-dependent and **no test covers it**. Do not assume it works;
  see US-16.

---

## 9. Background jobs

One real queue: `"exports"`, BullMQ over Redis.

- **Producer**: `jobs/queue.ts` lazily constructs the `Queue`.
- **Consumer**: `jobs/export.processor.ts` registers a `Worker` that calls
  `exportsService.processJob(...)`. It is registered **both** by `server.ts:13` (so the
  API process also processes jobs) and by `worker.ts` (so you can scale it out).
- **`jobs/metricSnapshot.processor.ts` and `jobs/monitoringRollup.processor.ts` are
  empty stubs** — three lines each, returning `Promise.resolve()`, never imported
  anywhere. US-12 and US-19 fill them in.

The export flow (`modules/exports/exports.service.ts`) is worth reading closely because
it is the most "production-shaped" code in the repo:

1. `create()` inserts a `PENDING` job row and writes an `EXPORT_REQUESTED` audit event.
2. It **estimates the row count** and decides sync vs async: ≤ 10,000 rows
   (`MAX_SYNC_EXPORT_ROWS`, `:18`) runs inline so the user gets an instant download;
   anything larger goes on the queue.
3. If enqueueing throws (Redis down), it logs `export.queue.unavailable.falling_back`
   and processes inline anyway (`:60-69`). Degraded, not broken.
4. `processJob()` sets `PROCESSING`, builds rows, writes a CSV to
   `EXPORT_STORAGE_DIR`, and on success sets `COMPLETED` + `rowCount` + `fileUrl` +
   a 7-day `expiresAt`, then emits a `CSV_EXPORTED` tracked event and an
   `EXPORT_COMPLETED` audit event. On failure it sets `FAILED` with the message, emits
   `BACKGROUND_JOB_FAILED`, and rethrows so BullMQ can retry.
5. Row builders cap at 25,000 rows per export (`:249`, `:273`, `:290`).

**CSV injection is handled**: `shared/utils/csv.ts:6-11` prefixes any cell starting
with `= + - @` with a single quote so Excel will not execute it, and every cell is
quoted with `"` doubled. This is one of the genuinely well-done bits — don't undo it.

---

## 10. Frontend architecture

- **Routing** (`app/router.tsx`): `createBrowserRouter`, every page `React.lazy`-loaded
  and wrapped in `<Suspense>`. Nesting is `RequireAuth` → `AppLayout` → optional
  `RequireRole` → page.
- **Server state** is TanStack Query, *only*. There is no redux/context for data.
  Defaults (`lib/queryClient.ts`): `staleTime: 60_000`, `retry: 1`,
  `refetchOnWindowFocus: false`. Query keys are hand-written arrays like
  `["dashboard", "recent-activity", startDate, endDate]` — include every input that
  changes the result or you will serve stale data across filter changes.
- **Client state** is zustand, and today the only client state is the auth session.
- **Filters live in the URL.** `useDashboardFilters()` (`features/dashboard/hooks/`)
  reads `startDate`/`endDate`/`interval`/`eventType` from `useSearchParams` and writes
  them back on change. That makes every dashboard view shareable by URL. Keep it that
  way — do not move filters into `useState`.
- **API layer** (`api/*.ts`): one module per backend module, each function a one-liner
  over `apiClient<T>()`. `apiClient` injects the bearer token from the zustand store,
  throws `new Error(payload.error.message)` on non-2xx, and returns parsed JSON
  (`api/client.ts`). It does **not** handle 401 by refreshing — see US-04.
- **Feature folders** own their `components/`, `hooks/`, and `pages/`. Generic,
  reusable pieces live in `src/components/`. If a component is used by two features it
  moves up; until then it stays in the feature.
- **Charts** are Recharts, always wrapped in `<ChartCard title description>`, always
  fed data that the server already shaped.
- **Styling** is Tailwind 4 with CSS custom properties (`var(--surface)`,
  `var(--primary)`, …) defined in `styles.css`. Use the variables, not raw hex.

### Page inventory

| Route | Component | Notes |
| --- | --- | --- |
| `/login` | `LoginPage` | Pre-fills the seeded admin credentials |
| `/` | `OperationsDashboardPage` | KPIs, events over time, events by type, error rate, recent activity |
| `/product` | `ProductDashboardPage` | KPIs, active users, conversion funnel, event volume |
| `/engineering` | `EngineeringDashboardPage` | Latency, DB time, error rate, queue depth, job failures |
| `/executive` | `ExecutiveDashboardPage` | KPIs + one trend, deliberately minimal |
| `/events`, `/events/:id` | `EventLogPage`, `EventDetailPage` | Raw tracked-event table |
| `/audit` | `AuditDashboardPage` | By action, by actor, over time, recent records |
| `/monitoring` | `MonitoringDashboardPage` | **A 5-line re-export of `EngineeringDashboardPage`** (`features/monitoring/pages/MonitoringDashboardPage.tsx:1-5`) |
| `/exports` | `ExportCenterPage` | Create / download / retry CSV jobs |
| `/dashboard-configs` | `DashboardConfigPage` | CRUD over `DashboardConfig` |

---

## 11. Testing

The current suite is thin — 3 backend files, 1 frontend component test, 2 Playwright
specs — and none of it touches the database.

| Where | Runner | What exists |
| --- | --- | --- |
| `backend/tests/unit/` | Vitest | `csv.test.ts`, `permissions.test.ts` |
| `backend/tests/integration/` | Vitest + Supertest | `health.test.ts` — one test, hits `/health` |
| `frontend/src/test/` | Vitest + Testing Library + jsdom | `KpiCardGrid.test.tsx` |
| `frontend/src/test/e2e/` | Playwright | `login.spec.ts`, `role-dashboards.spec.ts` (both assert a single string) |

CI (`.github/workflows/ci.yml`) runs install → `db:generate` → typecheck → test →
build. **It starts no Postgres and no Redis service**, which is exactly why no
DB-backed test exists. US-20 fixes that.

What good tests look like here:

- **Pure functions** (`shared/utils/*`, `shared/permissions.ts`) → plain unit tests. No
  mocks needed. This is where the highest value per line is.
- **Routes** → Supertest against `createApp()`, with a real token minted by
  `signAccessToken`. Assert status codes *and* the exact `error.code`.
- **Role behaviour** → loop over all seven roles in one `it.each`. Any change to the
  permission matrix should break a test.
- **Components** → render with a `QueryClientProvider`, assert on user-visible text.
  `KpiCardGrid.test.tsx` is the pattern to copy.

---

## 12. Conventions you must copy

These are not style preferences; breaking them will fail typecheck or break at runtime.

1. **Backend is ESM.** `backend/package.json` has `"type": "module"`, so every relative
   import **must** end in `.js` even though the file is `.ts`:
   `import { prisma } from "../../db/prisma.js";`. Omit it and Node throws at runtime.
2. **Never read `process.env` outside `config/env.ts`.** It is zod-validated once at
   boot and exported as a typed `env` object. (One existing violation:
   `auth.service.ts:181` reads `process.env.JWT_REFRESH_EXPIRES_IN` directly. Do not
   copy that.)
3. **Every async route handler is wrapped in `asyncHandler`.** Without it, a rejected
   promise escapes Express and the request hangs.
4. **Throw `AppError(ERROR_CODES.X, message, status)`, never `res.status(400).json(...)`
   from a service.** The error middleware owns response formatting.
5. **Zod schemas always have the `{ body, query, params }` shape**, even when two of
   the three are `z.object({}).optional()`. `validate()` depends on it.
6. **Only repositories import `prisma`.** If a service needs a new query, add a
   repository method.
7. **Any state-changing admin action writes an audit event** via
   `auditService.record({ actorId, action, entityType, entityId, metadata })`. Anything
   users do that is interesting for analytics writes a `TrackedEvent`. Many actions
   write both — that duplication is intentional (§7).
8. **New cached endpoint → add a builder to `cacheKeys.ts`**, and include the role in
   the key if the payload is role-dependent.
9. **Frontend: no data fetching outside `src/api/`**, and no `useEffect(fetch)` — use
   TanStack Query.
10. **Dates cross the wire as `YYYY-MM-DD` strings**, never `Date` objects.

---

## 13. Known gaps

Honest list from the 2026-07-24 read. `docs/upskill/08-reference/risk-register.md`
already covers rate limiting, summary scaling, queue-depth accuracy, export
idempotency, and the `DataTable` key — those are still accurate. The following extends
it. Each line maps to the story that addresses it.

**Broken for the user right now**

| # | What | Where | Story |
| --- | --- | --- | --- |
| 1 | Sidebar shows Exports/Product/Engineering to every role, but the backend 403s several of them — those users land on a page that spins or errors | `layout/Sidebar.tsx:6-12` vs `shared/permissions.ts:13-48` | US-01 |
| 2 | "Last 30 days" ends at **midnight UTC today**, so today's events are missing from every dashboard | `lib/formatDate.ts:5-14` + `shared/utils/dates.ts:11-40` | US-02 |
| 3 | Most cards render `<LoadingState>` forever when a query *errors*, because they only check `data` truthiness | e.g. `ExportCenterPage.tsx:60-108` | US-03 |
| 4 | Access token expires after 15m and nothing refreshes it; the app just starts failing until manual re-login. `refreshSession()` exists and is never called | `api/client.ts:5-30`, `api/auth.api.ts:34-39` | US-04 |
| 5 | Event log has no pagination UI — it always shows page 1 (25 rows) of a 10,000-row dataset with no indication more exists | `features/events/hooks/useEvents.ts` | US-05 |
| 6 | Retrying a failed export resets the old row to `PENDING` and then creates a *second* job; the original stays `PENDING` forever and inflates queue depth | `exports.service.ts:101-122` | US-09 |
| 7 | `/monitoring` is literally the same component as `/engineering` | `MonitoringDashboardPage.tsx:1-5` | US-13 |
| 8 | Seeded export rows advertise files that were never written; Download streams a missing path | `seed.ts:128-142` | US-10 |

**Design/correctness debt**

| # | What | Where | Story |
| --- | --- | --- | --- |
| 9 | `POST /api/events/track` and `POST /api/monitoring/metrics` are **writes gated by `*:view` permissions** | `events.routes.ts:11`, `monitoring.routes.ts:11` | US-19 |
| 10 | `validate()` discards the parsed result, so `z.coerce` never reaches the controller | `validate.middleware.ts:10-14` | US-05 |
| 11 | `metricVisibilityMiddleware` mutates `request.query`, which may not survive Express 5's getter; untested either way | `metricVisibility.middleware.ts:8` | US-16 |
| 12 | No cache invalidation exists at all — `cacheService` has no `del` | `cache/cache.service.ts` | US-16 |
| 13 | `eventsService.getSummaryByType` fires **22 queries** (a findMany + count per enum value) to produce 11 numbers | `events.service.ts:38-53` | US-17 |
| 14 | Audit summaries pull up to 10,000 rows into Node and group with `.reduce()` | `audit.service.ts:52-91` | US-17 |
| 15 | Queue depth is counted from `ExportJob` rows, not from BullMQ — it cannot see stuck or delayed jobs | `monitoring.repository.ts:34-47` | US-15 |
| 16 | Export jobs are visible only to their requester, so an admin cannot debug someone else's failed export | `exports.service.ts:78-86` | US-10 |
| 17 | `users` module is read-only: no create, no role change, no deactivate, and no UI at all | `users.routes.ts:11` | US-07 |
| 18 | `MetricSnapshot` table and both rollup processors are dead code | `jobs/metricSnapshot.processor.ts` | US-12 |
| 19 | `DashboardConfig` CRUD works but `layoutJson` renders nothing | `DashboardConfigPage.tsx` | US-11 |
| 20 | Rate limiter is per-process memory and returns code `FORBIDDEN` with status 429, with no `Retry-After` | `rateLimit.middleware.ts` | US-18 |
| 21 | No refresh-token reuse detection; a stolen-then-rotated token fails silently instead of invalidating the family | `auth.service.ts:121-147` | US-04 |
| 22 | `morgan` is a declared dependency and is never imported (custom logger replaced it) | `backend/package.json:33` | — |
| 23 | CI runs no database, so no integration test can exist | `.github/workflows/ci.yml` | US-20 |

---

## 14. Glossary

- **Tracked event** — a product-analytics fact ("someone did X"). High volume, no FK to
  `User`, written by `eventsService.track()` or directly by services.
- **Audit event** — a compliance fact ("this actor changed that entity, from this IP").
  Lower volume, real FK to `User`, written by `auditService.record()`.
- **Monitoring metric** — an infrastructure measurement (latency, error rate, queue
  depth) with a numeric `value` and a `recordedAt`.
- **Metric snapshot** — a pre-computed rollup of a metric over a period. Modelled, unused.
- **KPI summary** — the eight numbers behind the cards at the top of a dashboard.
- **Metric visibility** — field-level filtering of a response by role
  (`applyMetricVisibility`), as opposed to endpoint-level permissions.
- **Export job** — a row in `ExportJob` tracking one CSV request through
  `PENDING → PROCESSING → COMPLETED | FAILED` (and `EXPIRED`, which nothing sets).
- **Dashboard config** — a saved, named widget layout scoped to a role.
- **Interval** — `"day"` or `"week"`, the `date_trunc` bucket size for time series.
