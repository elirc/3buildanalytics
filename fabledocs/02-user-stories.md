# 02 — User stories

Twenty implementation-ready stories for the Analytics + Admin Dashboard Platform.

Read [`01-app-overview.md`](01-app-overview.md) first. Every story assumes you know the
module pattern (routes → schemas → controller → service → repository), the three
authorization layers, and the conventions in § 12 of that document.

## How to work a story

1. Reproduce the current behaviour first. If the story says something is broken,
   **see it broken** in the running app before you change code.
2. Write the failing test before the fix. Several stories say so explicitly; do it
   even where they don't.
3. One story = one PR. The *Definition of done* list is your PR description checklist.
4. `npm run typecheck && npm run test` must pass before you open the PR. No exceptions —
   `typecheck` is also what CI calls `lint`.
5. If a story requires a schema change, generate the migration with
   `npm run db:migrate` and commit the generated SQL. Never hand-edit an applied migration.

## Order of work

**Tier 1 — start here.** Small, well-bounded, and each one teaches a layer you need later.

| # | Story | Touches | Size |
| --- | --- | --- | --- |
| US-01 | Make navigation match real permissions | frontend + shared rules | S |
| US-02 | Fix "last 30 days" losing today | frontend + backend utils | S |
| US-03 | Every page handles the error state | frontend | S |
| US-04 | Keep sessions alive with token refresh | frontend + backend | M |
| US-05 | Paginate and sort the event log | full stack | M |

**Tier 2 — feature work.** Real product surface, each shippable on its own.

| # | Story | Touches | Size |
| --- | --- | --- | --- |
| US-06 | Saved views for dashboard filters | full stack + schema | M |
| US-07 | User administration screen | full stack | L |
| US-08 | Export builder with real filters | full stack | M |
| US-09 | Correct export retry + live status | backend + frontend | M |
| US-10 | Export retention, expiry, and admin visibility | backend + job | M |
| US-11 | Dashboard configs that actually drive layout | full stack | L |
| US-12 | Metric snapshot rollup job | backend + job | L |

**Tier 3 — platform.** Harder, more design judgement, review with a senior first.

| # | Story | Touches | Size |
| --- | --- | --- | --- |
| US-13 | A real monitoring page with alert rules | full stack + schema | L |
| US-14 | Period-over-period comparison on KPIs | full stack | M |
| US-15 | Queue depth from BullMQ, not from rows | backend | M |
| US-16 | Cache invalidation and a working refresh | backend | M |
| US-17 | Push summary aggregation into SQL | backend | M |
| US-18 | Distributed rate limiting done properly | backend | M |
| US-19 | Make monitoring metrics real | backend | M |
| US-20 | Database-backed tests and CI | tests + CI | L |

---

# Tier 1

## US-01 — Make navigation match real permissions

**As a** user with a limited role (read-only, executive, ops)
**I want** the sidebar to show only the pages I can actually open
**so that** I never click a link that leads to a spinner or an error.

### Current behaviour

`frontend/src/layout/Sidebar.tsx:6-12` renders Operations, Product, Engineering,
Executive, and **Exports** unconditionally for every role. But:

- `EXECUTIVE_VIEWER` and `READ_ONLY` only hold `dashboard:view`
  (`backend/src/shared/permissions.ts:45-47`), so `GET /api/exports` 403s for them.
- `/engineering` calls `GET /api/monitoring/summary`, which needs `monitoring:view` —
  `OPS_MANAGER`, `PRODUCT_MANAGER`, `AUDIT_VIEWER`, `EXECUTIVE_VIEWER`, and `READ_ONLY`
  all get 403.
- `/product` calls `GET /api/dashboard/conversion-funnel`, which is fine for everyone
  with `dashboard:view`, so that one is genuinely shared.

There are **three** places that encode access rules and they disagree: the backend
matrix (`shared/permissions.ts`), the router allowlists (`app/router.tsx:42-61`), and
the sidebar helpers (`lib/permissions.ts`). `canConfigureDashboards` in the frontend
says "anyone except READ_ONLY and EXECUTIVE_VIEWER", which happens to match the backend
today — by coincidence, not by construction.

### Scope

**Frontend**

1. Rewrite `frontend/src/lib/permissions.ts` so it mirrors the backend matrix exactly:
   export a `PERMISSIONS: Record<Role, Permission[]>` constant with the same eight
   permission strings the backend uses, plus `hasPermission(role, permission)`.
   Keep the existing named helpers (`canViewEvents`, etc.) as thin wrappers so nothing
   else breaks.
2. Add a `permission` field to each sidebar link and filter the list through
   `hasPermission`. Delete the `baseLinks` / conditional-spread split.
3. Change `RequireRole` to a `RequirePermission` guard that takes a `Permission`, and
   update `app/router.tsx` to guard by permission instead of by role list. Keep
   `RequireRole` exported if something still needs role-specific gating, but no route
   should use a hardcoded role array afterwards.
4. Guard the `/engineering` route with `monitoring:view` and `/exports` with
   `exports:view`.

**Backend**

5. Add `GET /api/auth/permissions` returning `{ permissions: Permission[] }` for the
   caller's role, and have the login/refresh responses include the same array on the
   user object. This makes the backend the single source of truth; the frontend
   constant from step 1 becomes a fallback for optimistic rendering only.
   *(If you prefer to keep this story frontend-only, skip step 5 and say so in the PR —
   but then add a test that fails if the two matrices drift.)*

### Definition of done

- [ ] Logging in as `read_only@example.com` shows exactly: Operations, Product, Executive. No Exports, no Engineering, no Events, no Audit, no Configs.
- [ ] Logging in as `engineering_admin@example.com` shows Operations, Product, Engineering, Executive, Exports, Monitoring, Configs — and not Events or Audit.
- [ ] Logging in as `system_admin@example.com` shows every link.
- [ ] Manually navigating to a forbidden path (typing `/engineering` as read-only) redirects to `/` rather than rendering an error page.
- [ ] No route in `app/router.tsx` contains a hardcoded array of role strings.
- [ ] A test fails if a permission is added to the backend matrix but not the frontend one.

### Tests

- `frontend/src/test/permissions.test.ts` — for each of the 7 roles, assert the exact set of sidebar links.
- `backend/tests/unit/permissions.test.ts` — extend with a case per role asserting the exact permission array (this is the contract the frontend mirrors).
- Playwright: extend `role-dashboards.spec.ts` to log in as read-only and assert Exports is absent from the DOM.

### Out of scope

Changing *who* gets which permission. The matrix stays as-is; only its enforcement
becomes consistent.

### Files

`frontend/src/lib/permissions.ts`, `frontend/src/layout/Sidebar.tsx`,
`frontend/src/auth/RequireRole.tsx`, `frontend/src/app/router.tsx`,
`backend/src/modules/auth/*` (if doing step 5), tests.

---

## US-02 — Fix "last 30 days" silently dropping today

**As an** operations manager
**I want** the default date range to include everything that happened today
**so that** the dashboard I check at 4pm reflects the incident that started at 9am.

### Current behaviour

`frontend/src/lib/formatDate.ts:5-14` builds `endDate` as `toISOString().slice(0,10)` —
today's calendar date. The backend turns that string into a `Date` via
`new Date("2026-07-24")`, which JavaScript interprets as **midnight UTC**
(`backend/src/shared/utils/dates.ts:16-17`). Every query then filters
`occurredAt <= 2026-07-24T00:00:00.000Z`.

Net effect: **today's data is invisible on every dashboard, every chart, and every
export.** With the seed this is easy to see — `seed.ts:47` spreads events across all 24
hours, so today's bucket looks empty or tiny compared to yesterday's.

There is a second, subtler bug in the same place: `getDefaultDateRange` uses local time
to compute the date and UTC to format it, so for users west of UTC the "today" it
produces can be tomorrow's date.

### Scope

**Backend**

1. Change `parseDateRange` to normalise: `startDate` → start of that day, `endDate` →
   **end** of that day (`23:59:59.999`). Decide and document the timezone: use UTC and
   say so in a comment, because the DB stores UTC and `date_trunc` in
   `dashboard.repository.ts` operates in the DB's timezone.
2. Accept both `YYYY-MM-DD` and full ISO datetimes. If the caller passed a full
   datetime, use it verbatim — do not widen it to the whole day.
3. Reject a `YYYY-MM-DD` string that is not a real date (`2026-02-31`) with a 400.
   `new Date()` currently rolls it over silently.

**Frontend**

4. Fix `getDefaultDateRange` to compute both dates in the same timezone as it formats them.
5. Add a `formatDateTime` helper and use it in the event log and audit tables, where
   `toLocaleDateString()` currently throws away the time
   (`features/events/pages/EventLogPage.tsx:54` uses `toLocaleString()`, but
   `lib/formatDate.ts:1-3` `formatDate` — used in the audit and exports tables — does not).

### Definition of done

- [ ] Creating a tracked event right now (`POST /api/events/track`) makes it appear on the Operations dashboard immediately, with the default range.
- [ ] `GET /api/dashboard/kpi-summary?startDate=X&endDate=X` (same day) returns that day's full 24 hours.
- [ ] `endDate=2026-02-31` returns 400 with code `BAD_REQUEST`.
- [ ] The 180-day / 365-day range caps still work and still return 400 when exceeded.
- [ ] No dashboard page changed its request shape — this is a semantics fix, not an API change.

### Tests

- `backend/tests/unit/dates.test.ts` (new): same-day range spans 00:00:00.000–23:59:59.999; inverted range → 400; over-cap range → 400; invalid calendar date → 400; explicit datetime passes through unmodified.
- `frontend/src/test/formatDate.test.ts` (new): `getDefaultDateRange()` returns exactly 30 distinct days ending today, in the local timezone.

### Out of scope

Per-user timezone preferences. Everything is UTC; a future story can add a picker.

### Files

`backend/src/shared/utils/dates.ts`, `frontend/src/lib/formatDate.ts`, tests.

---

## US-03 — Every page handles the error state

**As any** user
**I want** to see a clear error message when data fails to load
**so that** I know to retry or report it instead of staring at a spinner.

### Current behaviour

Pages guard on `data` truthiness, not on query status. `ExportCenterPage.tsx:60-108`
is the clearest example:

```tsx
{exportJobsQuery.data ? <DataTable … /> : <LoadingState label="Loading export history..." />}
```

When the request 403s or the API is down, `data` stays `undefined` forever and the user
sees "Loading export history..." permanently. The same pattern appears in every
`<ChartCard>` body across the dashboards, and in the audit and engineering pages.

Some pages do it right for their *primary* query (`OperationsDashboardPage.tsx:37-43`
checks `isLoading` then `isError`) but not for the secondary ones.

### Scope

1. Build `frontend/src/components/QueryBoundary.tsx`:

```tsx
<QueryBoundary query={someQuery} loadingLabel="Loading exports…">
  {(data) => <DataTable rows={data} … />}
</QueryBoundary>
```

   It renders `<LoadingState>` while pending, `<ErrorState message={…} onRetry={…}>`
   on error, `<EmptyState>` when the resolved data is an empty array, and otherwise
   calls the child function with non-nullable data.
2. Add a `onRetry` prop to `ErrorState` that calls `query.refetch()`, with a "Try again"
   button.
3. Replace every `query.data ? … : <LoadingState/>` ternary in `src/features/**` with
   `<QueryBoundary>`. There are roughly 20.
4. Make 403 responses read differently from 500s: `apiClient` should attach the
   `error.code` from the payload to the thrown error, and `ErrorState` should render
   "You don't have access to this data" for `FORBIDDEN` instead of the raw message.

### Definition of done

- [ ] Stopping the backend and reloading any page shows an error with a working "Try again" button, on every card, within one render.
- [ ] A role that lacks a permission sees an access message, not a spinner and not a stack-trace-ish string.
- [ ] A date range with genuinely zero data shows `<EmptyState>`, not an empty chart.
- [ ] No `query.data ?` ternary remains under `frontend/src/features/`.

### Tests

- `frontend/src/test/QueryBoundary.test.tsx`: pending → loading; error → message + retry button that calls `refetch`; empty array → empty state; data → children.
- One page-level test (`ExportCenterPage`) rendered with a query client whose fetch rejects, asserting the error UI.

### Out of scope

React error boundaries for render-time crashes — this story is about *query* failures only.

### Files

`frontend/src/components/QueryBoundary.tsx` (new), `ErrorState.tsx`, `EmptyState.tsx`,
`api/client.ts`, all pages under `frontend/src/features/`.

---

## US-04 — Keep sessions alive with token refresh

**As a** user working through a long shift
**I want** my session to keep working without re-logging in every 15 minutes
**so that** I don't lose my place mid-investigation.

### Current behaviour

Access tokens expire in 15 minutes (`JWT_ACCESS_EXPIRES_IN` default). The refresh
endpoint works and `refreshSession()` exists in `frontend/src/api/auth.api.ts:34-39` —
**and is never called from anywhere.** `apiFetch` (`api/client.ts:5-30`) attaches the
token and throws on any non-2xx without distinguishing 401. So after 15 minutes every
request fails with "Authentication required" and the user has to reload and log in
again — while `RequireAuth` still thinks they're logged in, because the zustand store
still holds a stale user.

### Scope

**Frontend**

1. In `api/client.ts`, on a 401 response: call `POST /api/auth/refresh` with the stored
   refresh token, store the new pair, and **replay the original request once**.
2. Implement **single-flight**: if ten queries 401 simultaneously, exactly one refresh
   request goes out and the other nine await it. A module-level
   `let refreshPromise: Promise<void> | null` is enough.
3. If refresh fails, call `clearSession()` and redirect to `/login` preserving the
   attempted path so the user returns where they were.
4. Never retry the refresh call itself, and never retry a request twice — one replay
   maximum, or you will build an infinite loop.

**Backend**

5. Implement **refresh-token reuse detection**. Today `refresh` revokes the presented
   token and issues a new one (`auth.service.ts:141-146`); presenting an
   already-revoked token just 401s. Instead: if the presented hash matches a token whose
   `revokedAt` is **not null**, revoke every unrevoked token for that user, write an
   audit event `REFRESH_TOKEN_REUSE_DETECTED`, and return 401. That turns a stolen
   token into a forced logout everywhere.
6. Add `POST /api/auth/logout-all` (requires authentication) that revokes every token
   for the caller.

### Definition of done

- [ ] Set `JWT_ACCESS_EXPIRES_IN=10s` locally; the app keeps working indefinitely with no visible interruption and no duplicate refresh calls in the network tab.
- [ ] With an invalid refresh token in localStorage, the first failed request logs the user out and lands them on `/login`, and after logging in they return to the page they were on.
- [ ] Replaying a used refresh token revokes the whole family and writes an audit row.
- [ ] Ten concurrent 401s produce exactly one `POST /api/auth/refresh`.

### Tests

- `frontend/src/test/client.test.ts`: mock `fetch`; 401 → refresh → replay returns data; concurrent calls → one refresh; failed refresh → `clearSession` called.
- `backend/tests/integration/auth.test.ts` (new): rotation issues a new pair; reuse of a revoked token 401s **and** revokes siblings; `logout-all` revokes everything.

### Out of scope

Moving tokens into httpOnly cookies. That is a larger security story — note it in the PR
as follow-up. (`cookie-parser` is already wired up in `app.ts:30` for whoever does it.)

### Files

`frontend/src/api/client.ts`, `frontend/src/auth/auth.store.ts`,
`backend/src/modules/auth/auth.service.ts`, `auth.routes.ts`, `auth.controller.ts`, tests.

---

## US-05 — Paginate and sort the event log

**As an** operations manager investigating an incident
**I want** to page through and sort the event log
**so that** I can reach the events that matter instead of only the newest 25.

### Current behaviour

The backend supports pagination end to end: `listEventsSchema` accepts `page`/`pageSize`
(`events.schemas.ts:6-7`), the controller forwards them, `getPagination`
(`shared/utils/pagination.ts`) clamps `pageSize` to 1–100 and defaults to 25, and the
response carries `{ items, total, page, pageSize }`.

The frontend uses none of it. `useEvents` (`features/events/hooks/useEvents.ts:5-10`)
takes only dates and an event type, and `EventLogPage` renders `query.data.items` with
no controls and no display of `total`. Sorting is hardcoded to `occurredAt desc` in the
repository. So the page silently shows 25 of 10,000 rows.

Note while you are here: `validate()` parses but throws away its result
(`validate.middleware.ts:10-14`), so the `z.coerce.number()` on `page`/`pageSize` does
nothing — `events.controller.ts:23-24` re-coerces by hand. Either fix `validate` to
assign the parsed values back (and check nothing else depended on the raw strings), or
leave the manual coercion and add a comment. Say which you chose in the PR.

### Scope

**Backend**

1. Add `sortBy` (`occurredAt` | `eventType` | `actorEmail`) and `sortDir` (`asc`|`desc`)
   to `listEventsSchema` and thread them to `eventsRepository.findMany`. **Allowlist
   the column** — never interpolate a caller-supplied string into `orderBy`.
2. Return `pageCount` alongside `total` so the client doesn't have to compute it.
3. Do the same for `GET /api/audit-events`, which has the identical shape.

**Frontend**

4. Extend `useDashboardFilters` to own `page`, `pageSize`, `sortBy`, `sortDir` in the
   URL, so a paginated, sorted view is shareable by link.
5. Build `frontend/src/components/Pagination.tsx`: "Showing 26–50 of 10,000",
   Previous/Next, a page-size selector (25 / 50 / 100), and disabled states at the ends.
6. Make `DataTable` column headers clickable to sort when the column declares
   `sortable: true`, with an ascending/descending indicator.
7. Reset to page 1 whenever a filter or the sort changes — otherwise the user lands on
   an empty page 40 of a 3-page result.

### Definition of done

- [ ] The event log shows "Showing 1–25 of N" with the correct N for the seeded data.
- [ ] Next/Previous work, are disabled at the boundaries, and change the URL.
- [ ] Reloading a URL with `?page=3&sortBy=eventType&sortDir=asc` restores that exact view.
- [ ] Changing the date range or event type resets to page 1.
- [ ] `sortBy=occurredAt;DROP TABLE` returns 400, not a 500 and certainly not a query.
- [ ] The audit table gets the same treatment.

### Tests

- `backend/tests/integration/events.test.ts` (new): page 2 returns different ids than page 1; `pageSize=500` is clamped to 100; invalid `sortBy` → 400; `sortDir=asc` reverses the first row.
- `frontend/src/test/Pagination.test.tsx`: boundary disabled states, correct range label, callbacks fire.

### Out of scope

Cursor-based pagination. Offset is fine at this data size; note the tradeoff in the PR.

### Files

`backend/src/modules/events/{events.schemas,events.controller,events.service,events.repository}.ts`,
same for `audit`, `frontend/src/components/{DataTable,Pagination}.tsx`,
`frontend/src/features/events/*`, `frontend/src/features/audit/*`, tests.

---

# Tier 2

## US-06 — Saved views for dashboard filters

**As a** product manager who checks the same three slices every morning
**I want** to save a filter combination under a name and re-open it in one click
**so that** I stop re-entering dates and event types every day.

### Why

Filters already live in the URL (`useDashboardFilters`), so the hard part — a
serialisable view state — is done. This story makes it durable and shareable, and it is
the smallest story in the pack that introduces a **new Prisma model**, so it is the
right place to learn the migration workflow.

### Scope

**Schema** — add to `backend/prisma/schema.prisma`:

```prisma
model SavedView {
  id          String   @id @default(uuid())
  name        String
  ownerId     String
  owner       User     @relation(fields: [ownerId], references: [id])
  page        String   // "operations" | "product" | "engineering" | "events" | "audit"
  filtersJson Json     // { startDate, endDate, interval, eventType, page, pageSize, sortBy, sortDir }
  isShared    Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([ownerId])
  @@index([page])
}
```

Add the reverse relation on `User`. Generate the migration; do not hand-write it.

**Backend** — a new `modules/savedViews/` module following the five-file pattern:

- `GET /api/saved-views?page=operations` — the caller's own views plus any `isShared` ones.
- `POST /api/saved-views` — create; the owner is always `req.user.id`, never from the body.
- `PATCH /api/saved-views/:id` — rename, update filters, toggle `isShared`. **Owner only.**
- `DELETE /api/saved-views/:id` — owner, or `SYSTEM_ADMIN`.
- Add a `views:manage` permission granted to every role except `READ_ONLY`.
- Every mutation writes an audit event (`SAVED_VIEW_CREATED` / `_UPDATED` / `_DELETED`).
- Cap: 50 views per user, 400 with a clear message beyond that.

**Frontend**

- A "Saved views" dropdown in `DashboardFilterBar` listing the current page's views, with
  "Save current view…" and a rename/delete affordance on each row.
- Selecting a view writes its filters into the URL via `updateFilters` — the rest of the
  page reacts automatically.
- Shared views show an owner badge and are read-only for non-owners.

### Definition of done

- [ ] Saving a view on Operations, reloading, and selecting it restores the exact filter state.
- [ ] Views are scoped to their page — a view saved on Product does not appear on Events.
- [ ] User A cannot `PATCH` or `DELETE` user B's view (404, not 403 — don't leak existence).
- [ ] A shared view is visible to everyone but editable only by its owner.
- [ ] `READ_ONLY` sees no save controls and gets 403 from the API.
- [ ] The 51st view returns 400.

### Tests

- `backend/tests/integration/savedViews.test.ts`: ownership isolation, shared visibility, the 50 cap, the audit row.
- Frontend: selecting a view calls `updateFilters` with the stored payload.

### Out of scope

Scheduling or emailing a saved view. Different story.

### Files

`backend/prisma/schema.prisma` + migration, `backend/src/modules/savedViews/*`,
`backend/src/shared/permissions.ts`, `backend/src/app.ts`,
`frontend/src/api/savedViews.api.ts`, `frontend/src/features/dashboard/components/DashboardFilterBar.tsx`.

---

## US-07 — User administration screen

**As a** system administrator
**I want** to manage users — invite, change role, deactivate — from the UI
**so that** onboarding and offboarding do not require database access.

### Current behaviour

`users` is the thinnest module in the codebase: one route, `GET /api/users` behind
`users:manage` (`users.routes.ts:11`), returning a paginated list. There is **no
frontend page at all** and no way to change a role or deactivate anyone. Meanwhile
`auth.service.ts:26-71` has a full `register()` that accepts an arbitrary `role` and is
mounted **unauthenticated** at `POST /api/auth/register` — anyone who can reach the API
can mint themselves a `SYSTEM_ADMIN`. Closing that hole is part of this story.

### Scope

**Backend**

1. `POST /api/users` (`users:manage`) — create a user with an assigned role. Move the
   creation logic out of `authService.register` into `usersService.create` and have both
   call it.
2. **Lock down public registration.** Either remove `POST /api/auth/register` entirely
   or restrict it to a role of `READ_ONLY` regardless of what the body says. Pick one,
   justify it in the PR, and add a test that a request asking for `SYSTEM_ADMIN` cannot
   get it.
3. `PATCH /api/users/:id` (`users:manage`) — update `firstName`, `lastName`, `role`,
   `isActive`. Guards:
   - You cannot change your own role (prevents locking yourself out mid-edit).
   - You cannot deactivate yourself.
   - You cannot demote the **last active `SYSTEM_ADMIN`** — 400 with a clear message.
4. Deactivating a user must **revoke all their refresh tokens** in the same transaction.
   Login already rejects inactive users (`auth.service.ts:92-94`), but an existing
   access token stays valid until it expires — say so in the PR and consider a
   short-lived denylist as follow-up.
5. Every mutation writes an audit event with before/after values in `metadata`
   (`USER_CREATED`, `USER_ROLE_CHANGED`, `USER_DEACTIVATED`, `USER_REACTIVATED`) and a
   tracked `ADMIN_ACTION` event.
6. Extend `GET /api/users` with `search` (email/name, case-insensitive), `role`, and
   `isActive` filters plus the sorting from US-05.

**Frontend**

7. `/users` page, guarded by `users:manage`, with a sidebar entry.
8. Table: name, email, role, status, created. Row actions: Edit role (select),
   Activate/Deactivate (with a confirmation dialog naming the user), and a "New user" form.
9. Optimistic updates via TanStack Query mutations with rollback on error, and a toast on success.

### Definition of done

- [ ] A `SYSTEM_ADMIN` can create a user, change their role, deactivate and reactivate them, entirely from the UI.
- [ ] A deactivated user's existing session cannot refresh, and they cannot log in.
- [ ] Demoting the last admin returns 400 and the UI shows the message.
- [ ] Every one of those actions appears on the Audit dashboard within its date range.
- [ ] `POST /api/auth/register` can no longer produce a privileged account.
- [ ] Non-admin roles get 403 from every `/api/users` route and never see the nav link.

### Tests

- `backend/tests/integration/users.test.ts`: last-admin guard; self-role-change guard; deactivate revokes tokens; search/filter results; 403 for each non-admin role.
- Frontend: role select fires the mutation with the right payload; confirmation dialog blocks until confirmed.

### Out of scope

Email invitations and password reset flows. There is no mail transport in this project yet.

### Files

`backend/src/modules/users/*`, `backend/src/modules/auth/auth.{routes,service}.ts`,
`frontend/src/features/users/*` (new), `frontend/src/app/router.tsx`,
`frontend/src/layout/Sidebar.tsx`, `frontend/src/api/users.api.ts` (new).

---

## US-08 — Export builder with real filters

**As an** analyst
**I want** to choose exactly what goes into my CSV
**so that** I get the rows I need instead of a fixed last-30-days dump.

### Current behaviour

`ExportCenterPage.tsx:20-29` hardcodes the filters to `getDefaultDateRange()` — the user
picks a type from a dropdown and gets whatever the last 30 days holds. The backend is
far more capable than the UI: `createExportSchema` accepts an arbitrary
`filters: z.record(z.unknown())` (`exports.schemas.ts:6`), and `buildDateFilter`
(`exports.service.ts:326-345`) reads `startDate`/`endDate` from it — silently returning
**an unfiltered query** if either is missing or unparseable. So a typo in a filter key
exports the entire table (capped at 25,000 rows).

### Scope

**Backend**

1. Replace the `z.record(z.unknown())` catch-all with a **discriminated union keyed on
   `exportType`**, so each export type declares its own filter schema:
   - `TRACKED_EVENTS`: `startDate`, `endDate` (both required), `eventType?`, `actorId?`, `entityType?`, `search?`
   - `AUDIT_EVENTS`: `startDate`, `endDate` (required), `action?`, `actorId?`, `entityType?`
   - `MONITORING_METRICS`: `startDate`, `endDate` (required), `metricType?`
   - `KPI_SUMMARY`: `startDate`, `endDate` (required)
2. Make `buildDateFilter` **throw a 400** on missing/invalid dates instead of returning `{}`.
3. Apply the non-date filters in `buildExportRows` — today they are accepted and ignored.
4. Return the estimated row count from `POST /api/exports` so the UI can warn before a
   large export.

**Frontend**

5. Replace the single dropdown with a form: export type, date range (reusing
   `DateRangePicker`), and type-specific fields that appear based on the selected type.
6. Show a live estimated row count as filters change (debounced), and a warning above
   10,000 rows explaining the export will be queued rather than immediate.
7. Show each job's filters in the history table — a compact summary like
   `TRACKED_EVENTS · 2026-06-01→2026-06-30 · API_ERROR` — and add a "Run again" action
   that pre-fills the form from `filtersJson`.

### Definition of done

- [ ] Exporting `TRACKED_EVENTS` filtered to `API_ERROR` for one week produces a CSV containing only `API_ERROR` rows in that week.
- [ ] Omitting `startDate` returns 400 with a message naming the field, and does **not** create a job row.
- [ ] An unknown filter key returns 400 rather than being ignored.
- [ ] The history table shows what each job actually exported.
- [ ] "Run again" reproduces a previous export's filters exactly.

### Tests

- `backend/tests/unit/exportFilters.test.ts`: each export type's schema accepts valid input and rejects missing dates, unknown keys, and inverted ranges.
- `backend/tests/integration/exports.test.ts`: a filtered export's `rowCount` matches a direct count with the same filter.

### Out of scope

Column selection and non-CSV formats.

### Files

`backend/src/modules/exports/{exports.schemas,exports.service,exports.controller}.ts`,
`frontend/src/features/exports/*`, `frontend/src/api/exports.api.ts`.

---

## US-09 — Correct export retry and live status

**As a** user whose export failed
**I want** Retry to actually retry *that* export, and to see progress without reloading
**so that** I can trust the export center.

### Current behaviour — read this carefully, it is the best bug in the repo

`exportsService.retry` (`exports.service.ts:101-122`):

```ts
await exportsRepository.update(job.id, { status: PENDING, errorMessage: null, … });
return this.create({ …, exportType: job.exportType, filters: … });   // ← creates a SECOND job
```

It resets the failed job to `PENDING` and then calls `create()`, which inserts a
**brand new** job row. The original row is now `PENDING` forever: nothing will ever
process it. Each retry therefore leaves one permanently-pending orphan, and because
`monitoring.repository.ts:34-47` derives "queue depth" by counting `PENDING` rows, the
engineering dashboard's queue backlog climbs by one on every retry and never comes down.

Second problem: the UI never polls. `ExportCenterPage` fetches once
(`staleTime: 60_000`, `refetchOnWindowFocus: false`), so a queued export appears stuck
at `PENDING` until the user manually reloads.

Third: `processJob` has no idempotency guard. If BullMQ redelivers a job (it retries on
failure by design), the same export can be processed twice, writing two `CSV_EXPORTED`
tracked events and two `EXPORT_COMPLETED` audit rows for one user action. This is item
"Export idempotency" in `docs/upskill/08-reference/risk-register.md`.

### Scope

1. Rewrite `retry` to **reuse the existing row**: reset status/error/file fields, then
   enqueue (or inline-process) *that* `job.id`. It must never call `create()`.
2. Add a `retryCount` column to `ExportJob` (migration), increment it on each retry, and
   refuse beyond 3 with a 400.
3. Guard `processJob`: re-read the job inside the handler and return early if it is
   already `PROCESSING` or `COMPLETED`. Use a conditional update
   (`updateMany` with `where: { id, status: { in: [PENDING, FAILED] } }`) and treat a
   zero-row result as "someone else has it".
4. Frontend: poll while any job is `PENDING` or `PROCESSING` — TanStack Query's
   `refetchInterval` returning `3000` conditionally, `false` when everything is settled.
   Show a spinner in the status cell and a relative "started 12s ago".
5. Surface `errorMessage` on failed rows (it is already stored and already returned) in
   an expandable cell.

### Definition of done

- [ ] Retrying a failed export leaves exactly the same number of `ExportJob` rows as before.
- [ ] Queue depth on the engineering dashboard returns to its baseline after a retry completes.
- [ ] Calling `processJob` twice for one id produces one CSV, one `CSV_EXPORTED` tracked event, and one `EXPORT_COMPLETED` audit event.
- [ ] A queued export visibly transitions `PENDING → PROCESSING → COMPLETED` with no manual reload, and polling stops once nothing is in flight.
- [ ] A 4th retry returns 400.

### Tests

- `backend/tests/integration/exports.test.ts`: retry keeps the row count constant and flips the original row to `COMPLETED`; double `processJob` is idempotent; the 4th retry 400s.
- Frontend: `refetchInterval` is `3000` when a job is pending and `false` when all are settled.

### Out of scope

Real progress percentages. Status transitions are enough.

### Files

`backend/prisma/schema.prisma` + migration,
`backend/src/modules/exports/{exports.service,exports.repository}.ts`,
`frontend/src/features/exports/pages/ExportCenterPage.tsx`.

---

## US-10 — Export retention, expiry, and admin visibility

**As a** system administrator
**I want** old export files cleaned up automatically and the ability to inspect anyone's export
**so that** the disk doesn't fill with stale PII and I can debug a colleague's failed job.

### Current behaviour

- Every completed export gets `expiresAt = now + 7 days` (`exports.service.ts:154`) and
  **nothing ever reads it.** The `EXPIRED` enum value exists and is never set. Files
  accumulate in `EXPORT_STORAGE_DIR` forever.
- `getById` 404s unless `job.requestedById === userId` (`exports.service.ts:78-86`), and
  `listForUser` only ever queries the caller's rows. A `SYSTEM_ADMIN` cannot see, debug,
  or clean up anyone else's export.
- The seed creates jobs whose `fileName` points at files that were never written
  (`seed.ts:128-142`), so Download on a seeded row streams a nonexistent path and fails
  with an unhandled stream error rather than a clean 404 — `exports.controller.ts:42`
  pipes a `createReadStream` without an `error` handler.

### Scope

**Backend**

1. Add a repeatable BullMQ job (`exports-cleanup`) that runs hourly: find `COMPLETED`
   jobs with `expiresAt < now`, delete the file from disk, null `fileName`/`fileUrl`,
   and set status `EXPIRED`. Log a summary count. Register it in `worker.ts` so it runs
   in the worker process, not in every API instance.
2. Make the retention window configurable: `EXPORT_RETENTION_DAYS` in `config/env.ts`,
   default 7.
3. Handle the stream error in `download`: attach `.on("error")` and return a clean 404
   (`ERROR_CODES.NOT_FOUND`, "Export file is no longer available") when the file is
   missing. Also reject `EXPIRED` jobs with a specific message before touching the disk.
4. Admin visibility: `GET /api/exports?all=true` returns every user's jobs for
   `SYSTEM_ADMIN` only, including `requestedBy` email; `getById` and `download` allow a
   `SYSTEM_ADMIN` through the ownership check. **Downloading someone else's export must
   write an audit event** (`EXPORT_DOWNLOADED_BY_ADMIN`) recording both user ids.
5. Fix the seed to either write real placeholder CSV files or create the jobs with
   `fileName: null` and status `PENDING`, so nothing advertises a file that doesn't exist.

**Frontend**

6. Show a "Expires in 3 days" column, greyed-out rows for `EXPIRED`, and a tooltip
   explaining why Download is unavailable.
7. For admins, an "All users" toggle that switches to the org-wide list with a
   Requested-by column.

### Definition of done

- [ ] A job whose `expiresAt` is in the past becomes `EXPIRED` and its file is gone from disk within one cleanup cycle.
- [ ] Downloading an expired or missing export returns a clean 404 JSON error — no unhandled stream error, no half-written response.
- [ ] A `SYSTEM_ADMIN` can list and download another user's export; a non-admin still gets 404.
- [ ] The admin download writes an audit row naming both users.
- [ ] `npm run db:seed` produces no rows advertising a nonexistent file.

### Tests

- `backend/tests/integration/exportsCleanup.test.ts`: expired job → status flipped, file removed, non-expired untouched.
- Ownership matrix test: owner / other user / admin × getById / download.

### Out of scope

Moving artifacts to object storage. Local disk stays; note S3 as follow-up.

### Files

`backend/src/jobs/exportCleanup.processor.ts` (new), `backend/src/jobs/queue.ts`,
`backend/src/worker.ts`, `backend/src/config/env.ts`,
`backend/src/modules/exports/*`, `backend/prisma/seed.ts`,
`frontend/src/features/exports/pages/ExportCenterPage.tsx`.

---

## US-11 — Dashboard configs that actually drive layout

**As an** ops manager
**I want** the dashboard config I create to change what my team's dashboard shows
**so that** the configuration screen stops being decorative.

### Current behaviour

Full CRUD exists for `DashboardConfig` — model, service with a transaction that enforces
one default per role (`dashboardConfigs.service.ts:51-67`), routes, and an admin page.
The seed creates one default config per role with
`layoutJson: { widgets: ["kpi-summary", "events-over-time", "recent-activity"] }`.

**Nothing reads `layoutJson`.** Every dashboard page hardcodes its widgets in JSX. The
editor UI can't even change the layout — `DashboardConfigPage.tsx:139-159` renders a
"Save changes" button that passes `selectedConfig.layoutJson` straight back unchanged,
with the honest comment "keeps layout changes simple and intentional for onboarding".

### Scope

**Shared contract**

1. Define a widget registry — a typed map from widget id to
   `{ component, title, description, requiredPermission, defaultSize }`. Ids to support
   initially: `kpi-summary`, `events-over-time`, `events-by-type`, `active-users`,
   `error-rate`, `conversion-funnel`, `recent-activity`, `api-latency`, `db-query-time`,
   `queue-depth`, `job-failures`.
2. Validate `layoutJson` with zod on write: `{ widgets: Array<{ id: string; size: "half" | "full" }> }`.
   Reject unknown ids with a 400 — today any JSON is accepted.

**Backend**

3. `GET /api/dashboard-configs/default?role=<role>` returning the default config for a
   role, readable by anyone with `dashboard:view` (not just `dashboard:configure`) —
   users need to *read* their layout without being able to *edit* it.
4. Filter the widget list server-side by the caller's permissions, so a config that
   includes `queue-depth` doesn't hand a monitoring widget to an ops manager.

**Frontend**

5. `DashboardRenderer` component: takes a config, maps ids through the registry, and
   renders each widget in a grid honouring `size`.
6. Rewrite `OperationsDashboardPage` to fetch its role's default config and render
   through `DashboardRenderer`, falling back to a hardcoded default layout if no config
   exists. Leave Product/Engineering/Executive hardcoded for now — one page proves the
   pattern.
7. Real editor: a two-column picker (available widgets ↔ selected widgets), reorder with
   up/down buttons, size toggle per widget, and a live preview.

### Definition of done

- [ ] Removing `recent-activity` from the ops default config and reloading `/` removes that card.
- [ ] Reordering widgets in the editor reorders them on the dashboard.
- [ ] Saving a config containing `{"id":"not-a-widget"}` returns 400.
- [ ] A user whose role lacks `monitoring:view` does not receive monitoring widgets even if the config lists them.
- [ ] Deleting the default config falls back to the hardcoded layout rather than an empty page.
- [ ] `isDefault` still behaves: setting a new default unsets the previous one for that role (existing transaction must keep passing).

### Tests

- `backend/tests/integration/dashboardConfigs.test.ts`: layout validation rejects unknown ids; permission filtering drops widgets; one-default-per-role invariant holds under concurrent updates.
- `frontend/src/test/DashboardRenderer.test.tsx`: renders the widgets a config names, in order; unknown id is skipped with a console warning rather than crashing.

### Out of scope

Drag-and-drop. Up/down buttons are enough and are more accessible.

### Files

`frontend/src/features/dashboard/widgetRegistry.tsx` (new),
`frontend/src/features/dashboard/components/DashboardRenderer.tsx` (new),
`frontend/src/features/dashboardConfigs/pages/DashboardConfigPage.tsx`,
`backend/src/modules/dashboardConfigs/*`.

---

## US-12 — Metric snapshot rollup job

**As an** executive loading a 12-month dashboard
**I want** it to respond in well under a second
**so that** long ranges are as usable as short ones.

### Why

The `MetricSnapshot` model exists (`schema.prisma:76-88`) with `metricKey`,
`metricType`, `value`, `dimensions`, `periodStart`, `periodEnd` — and **nothing writes
or reads it.** `jobs/metricSnapshot.processor.ts` is a three-line stub that returns
`Promise.resolve()` and is never imported.

Today a 365-day KPI request fires seven aggregate queries in parallel, six of them over
the full `TrackedEvent` table (`kpi.service.ts:29-52`). At seed scale that is tolerable;
at real scale it is not. The fix is standard: pre-aggregate per day, then read the rollups.

This is the most senior-flavoured story in Tier 2 — pair with someone on the design.

### Scope

1. Implement `registerMetricSnapshotProcessor` as a BullMQ worker on a new
   `metric-snapshots` queue, plus a **repeatable job** scheduled nightly (BullMQ
   `repeat: { pattern: "0 3 * * *" }`).
2. For a given day it computes and upserts one `MetricSnapshot` row per metric key:
   `events.total`, `events.by_type.<TYPE>`, `users.active`, `events.errors`,
   `exports.completed`, `jobs.failed`. Use `periodStart`/`periodEnd` as the day bounds
   and put the discriminator in `dimensions` (e.g. `{ eventType: "API_ERROR" }`).
3. Make it **idempotent** — re-running for the same day must overwrite, not duplicate.
   Add a unique constraint on `(metricKey, periodStart, periodEnd)` and use `upsert`.
   This needs a migration.
4. Add a CLI entry point (`npm run jobs:backfill -w backend -- --from 2026-04-01 --to 2026-07-24`)
   that walks a date range and computes snapshots for each day, so you can populate
   history from the seed data.
5. Teach `kpiService.getSummary` to choose its source: ranges wholly in the past and
   longer than 30 days read from `MetricSnapshot`; short or partly-today ranges keep
   using live queries. Return the source in the payload
   (`{ …metrics, _meta: { source: "snapshot" | "live" } }`) so it is observable.
6. Handle the boundary honestly: a range that ends today mixes complete snapshot days
   with a live partial day. Either sum snapshots for complete days and query live for
   today, or fall back to live for the whole range — pick one, document why in the PR.

### Definition of done

- [ ] Running the backfill over the seeded 90 days creates snapshots and the job is safely re-runnable.
- [ ] `GET /api/dashboard/kpi-summary` over 365 days returns the **same numbers** whether served from snapshots or live. This is the acceptance test that matters — write it first.
- [ ] Snapshot-served responses are measurably faster (record before/after in the PR).
- [ ] `_meta.source` correctly reports which path served the request.
- [ ] Deleting all snapshots degrades gracefully to live queries rather than returning zeros.

### Tests

- `backend/tests/integration/metricSnapshots.test.ts`: rollup for a known day matches a direct count; re-running produces no duplicates; snapshot-backed and live summaries agree over the same range; empty snapshot table → live fallback.

### Out of scope

Weekly/monthly rollups and dimension explosion. Daily granularity only.

### Files

`backend/src/jobs/metricSnapshot.processor.ts`, `backend/src/jobs/queue.ts`,
`backend/src/worker.ts`, `backend/src/modules/dashboard/kpi.service.ts`,
`backend/src/modules/dashboard/dashboard.repository.ts`,
`backend/prisma/schema.prisma` + migration, `backend/package.json` (script).

---

# Tier 3

## US-13 — A real monitoring page with alert rules

**As an** engineering admin
**I want** a monitoring page distinct from the engineering dashboard, with thresholds that flag problems
**so that** I find out about latency regressions without staring at charts.

### Current behaviour

`/monitoring` is five lines: `export function MonitoringDashboardPage() { return <EngineeringDashboardPage />; }`
(`features/monitoring/pages/MonitoringDashboardPage.tsx:1-5`). Two sidebar links lead to
identical pages. Meanwhile the backend exposes nine monitoring endpoints, of which the
engineering page uses six — `cache-hit-rate`, `job-failures`, and the per-type
`api-latency`/`error-rate` variants are partly unused.

Nothing anywhere defines what "bad" looks like. Every number renders in the same colour.

### Scope

**Schema** — `AlertRule` and `AlertEvent`:

```prisma
model AlertRule {
  id           String               @id @default(uuid())
  name         String
  metricType   MonitoringMetricType
  comparator   AlertComparator      // GREATER_THAN | LESS_THAN
  threshold    Float
  windowMinutes Int                 @default(15)
  isEnabled    Boolean              @default(true)
  createdById  String
  createdBy    User                 @relation(fields: [createdById], references: [id])
  createdAt    DateTime             @default(now())
  updatedAt    DateTime             @updatedAt
  events       AlertEvent[]

  @@index([metricType])
  @@index([isEnabled])
}

model AlertEvent {
  id            String    @id @default(uuid())
  ruleId        String
  rule          AlertRule @relation(fields: [ruleId], references: [id])
  observedValue Float
  status        AlertStatus @default(FIRING)   // FIRING | RESOLVED | ACKNOWLEDGED
  firedAt       DateTime  @default(now())
  resolvedAt    DateTime?
  acknowledgedById String?

  @@index([ruleId, status])
  @@index([firedAt])
}
```

**Backend**

1. `modules/alerts/` with CRUD for rules (`monitoring:view` to read, a new
   `alerts:manage` for write — grant to `SYSTEM_ADMIN` and `ENGINEERING_ADMIN`) and
   `GET /api/alerts/events` plus `POST /api/alerts/events/:id/acknowledge`.
2. An evaluation job (repeatable, every minute) that for each enabled rule averages the
   metric over `windowMinutes` and compares. **Deduplicate**: if a `FIRING` event already
   exists for the rule, do not fire again; when the value returns within threshold,
   resolve the open event. Without this you will generate one alert per minute forever.
3. Every fire and resolve writes an audit event.

**Frontend**

4. Build a genuine `/monitoring` page: an alert feed (firing first, then recent
   resolved), a rules table with enable/disable toggles, a rule editor, and the
   cache-hit-rate and job-failure-rate charts the engineering page omits.
5. Colour metric values by their rule thresholds — green/amber/red on the KPI cards.
6. A firing-alert count badge on the sidebar Monitoring link.

### Definition of done

- [ ] `/monitoring` and `/engineering` render different components.
- [ ] Creating a rule "API_LATENCY > 100ms over 15 minutes" fires exactly one alert against the seeded data, not one per evaluation.
- [ ] The alert resolves automatically when the metric recovers, and `resolvedAt` is set.
- [ ] Acknowledging removes it from the active feed but keeps it in history.
- [ ] Only `SYSTEM_ADMIN` and `ENGINEERING_ADMIN` can create rules; others get 403.
- [ ] Disabling a rule stops evaluation immediately.

### Tests

- `backend/tests/integration/alerts.test.ts`: threshold crossing fires once; repeated evaluation does not duplicate; recovery resolves; disabled rules are skipped; permission matrix.

### Out of scope

Notification delivery (email/Slack/PagerDuty). In-app only. Note it as follow-up.

### Files

`backend/prisma/schema.prisma` + migration, `backend/src/modules/alerts/*`,
`backend/src/jobs/alertEvaluation.processor.ts` (new),
`frontend/src/features/monitoring/*`, `frontend/src/layout/Sidebar.tsx`.

**Depends on US-19** for meaningful live metrics — without it you are alerting on seed data.

---

## US-14 — Period-over-period comparison on KPIs

**As an** executive
**I want** each KPI to show how it moved versus the previous period
**so that** I can tell a good week from a bad one at a glance.

### Current behaviour

`KpiCard` renders a label and a value. Eight absolute numbers with no baseline —
"12,431 events" means nothing without "up 8% from last month".

### Scope

**Backend**

1. Add `compare=previous_period` to `dashboardRangeSchema`. When present, `kpiService`
   computes the summary for the requested range **and** for the immediately preceding
   range of equal length, then returns:

```json
{ "totalEvents": { "value": 12431, "previous": 11502, "changePercent": 8.07 }, … }
```

2. **This changes the response shape.** Keep the flat shape as the default and only
   return the enriched shape when `compare` is passed, or version the endpoint. Do not
   silently break `KpiCardGrid`.
3. Run both windows in one `Promise.all` — don't double the latency.
4. Respect `applyMetricVisibility` for the comparison values too. A hidden metric must
   be hidden in both halves; check this explicitly, it is easy to leak a value through
   the `previous` field.
5. Cache key must include the compare flag (`cacheKeys.ts`).

**Frontend**

6. `KpiCard` gains an optional delta: arrow, percentage, and colour. Critical detail —
   **direction is metric-specific**: more events is good, more errors is bad. Add a
   `higherIsBetter` flag to the card config in `KpiCardGrid`.
7. Add a sparkline of the last N buckets under each card, fed by the existing
   `events-over-time` data. No new endpoint.
8. A comparison toggle in `DashboardFilterBar`, persisted in the URL like every other filter.

### Definition of done

- [ ] With comparison on, each card shows a signed percentage and an arrow.
- [ ] Error rate rising renders red; total events rising renders green.
- [ ] A previous period of zero renders "—", not `Infinity%` or `NaN`.
- [ ] Comparison off produces byte-identical responses to today's.
- [ ] A role that cannot see `averageApiLatencyMs` receives neither its value nor its previous value.
- [ ] Turning comparison on does not measurably slow the endpoint (both windows in parallel).

### Tests

- `backend/tests/unit/kpiComparison.test.ts`: previous window bounds are exactly the same length immediately before; divide-by-zero yields `null`; visibility filtering applies to both halves.
- `frontend/src/test/KpiCard.test.tsx`: `higherIsBetter` flips the colour; null delta renders the em dash.

### Out of scope

Arbitrary custom comparison ranges ("vs. same week last year").

### Files

`backend/src/modules/dashboard/{kpi.service,dashboard.schemas,dashboard.controller}.ts`,
`backend/src/cache/cacheKeys.ts`, `frontend/src/features/dashboard/components/{KpiCard,KpiCardGrid,DashboardFilterBar}.tsx`.

---

## US-15 — Queue depth from BullMQ, not from database rows

**As an** engineering admin
**I want** the queue metrics to reflect the actual queue
**so that** "backlog: 0" means the queue is empty.

### Current behaviour

`monitoringRepository.getQueueDepth` (`monitoring.repository.ts:34-47`) counts
`ExportJob` rows by status. That is a proxy, and a leaky one:

- A job stuck in Redis with no consumer shows as `PENDING` — indistinguishable from one
  that was never enqueued.
- Delayed and retrying jobs are invisible.
- Every orphan row from the US-09 retry bug inflates it permanently.
- If Redis is flushed, the DB still claims a backlog.

This is the "Queue depth may not match real queue" row in the existing risk register.

### Scope

1. Add `getQueueMetrics()` using BullMQ's `queue.getJobCounts()` →
   `{ waiting, active, delayed, failed, completed, paused }`.
2. Change `GET /api/monitoring/queue-depth` to return both sources side by side:
   `{ queue: {…from BullMQ…}, jobs: {…from DB…}, redisAvailable: boolean }`. Showing
   both is the point — a divergence between them *is* the signal that something is wrong.
3. Degrade gracefully when Redis is down: `redisAvailable: false`, `queue: null`, DB
   counts still returned. Never 500 the monitoring page because monitoring is down.
4. Add `GET /health/ready` real checks — `app.ts:39-43` currently returns
   `{ status: "ready" }` unconditionally, which makes it useless as a readiness probe.
   Ping Postgres (`SELECT 1`) and Redis (`PING`), return 503 with a per-dependency
   breakdown if either fails.
5. Frontend: split the queue card into "In queue" and "Job rows", and show a warning
   banner when they disagree by more than a small tolerance or when Redis is unavailable.

### Definition of done

- [ ] With Redis running and an empty queue, `queue.waiting` is 0 regardless of DB row states.
- [ ] Stopping Redis leaves the monitoring page working, showing `redisAvailable: false` and DB-only counts.
- [ ] `/health/ready` returns 503 with a named failing dependency when Postgres or Redis is down, and 200 with both green otherwise.
- [ ] A divergence between queue and DB counts is visible in the UI.

### Tests

- `backend/tests/integration/monitoring.test.ts`: mock the queue client to return known counts; assert the payload; assert the Redis-down path returns 200 with `redisAvailable: false`.
- `health.test.ts`: extend for the ready endpoint's failure mode.

### Out of scope

A full BullMQ admin UI (bull-board). Read-only metrics.

### Files

`backend/src/jobs/queue.ts`, `backend/src/modules/monitoring/{monitoring.repository,monitoring.service,monitoring.controller}.ts`,
`backend/src/app.ts`, `frontend/src/features/dashboard/pages/EngineeringDashboardPage.tsx`.

---

## US-16 — Cache invalidation and a refresh control that works

**As a** system administrator
**I want** to force fresh data, and I want the cache to clear itself when data changes
**so that** dashboards aren't up to five minutes wrong with no way to fix it.

### Current behaviour

`cacheService` has exactly two methods, `get` and `set`
(`cache/cache.service.ts:3-19`). There is **no delete and no invalidation anywhere**.
KPI summaries live for 300s and monitoring summaries for 60s, and new events cannot
displace them.

The only escape hatch is `?refresh=true`, which `kpiService` honours
(`kpi.service.ts:22-27`). `metricVisibilityMiddleware` is supposed to restrict that to
admins, and it does so by assigning to `request.query.refresh`
(`metricVisibility.middleware.ts:8`). In Express 5 `request.query` is a getter that
re-parses the query string, so **whether that assignment is visible to the controller is
version-dependent, and there is no test either way.** Also note the middleware is only
mounted on `dashboardRouter` — `monitoringRouter` has no equivalent, though its service
ignores `refresh` entirely today.

Start this story by writing a test that asserts a non-admin's `?refresh=true` is
ignored. Find out whether it passes before you change anything, and put the answer in
the PR — that is the deliverable, not just the fix.

### Scope

1. Extend `cacheService` with `del(key)` and `delByPrefix(prefix)` (SCAN + UNLINK, never
   `KEYS` in a loop on a live Redis). Keep the error-swallowing behaviour but log at
   `warn` — silent cache failures are how a broken Redis stays invisible.
2. Add a `CacheInvalidator` used by the write paths: creating a tracked event, an audit
   event, or a monitoring metric invalidates the affected prefixes
   (`dashboard:*`, `audit:*`, `monitoring:*`). Do it **after** the write commits, and do
   not let an invalidation failure fail the request.
3. Replace the query-mutation approach: parse `refresh` in the controller and pass
   `refresh: req.query.refresh === "true" && req.user.role === "SYSTEM_ADMIN"` to the
   service. Then delete `metricVisibility.middleware.ts` — it is doing something its name
   doesn't describe, and its actual job now lives where it can be tested.
4. Add an `X-Cache: HIT | MISS | BYPASS` response header on cached endpoints so cache
   behaviour is observable from the network tab.
5. Track a real cache hit rate and write it as a `CACHE_HIT_RATE` monitoring metric
   (ties into US-19), so the existing cache-hit-rate chart stops being seed-only.
6. Frontend: a "Refresh data" button visible only to `SYSTEM_ADMIN` that refetches with
   `refresh=true`.

### Definition of done

- [ ] A non-admin passing `?refresh=true` gets a cached response (`X-Cache: HIT`) — proven by a test.
- [ ] An admin passing `?refresh=true` gets `X-Cache: BYPASS` and a recomputed payload.
- [ ] Creating a tracked event makes the next KPI request a `MISS` with updated numbers, without waiting 300s.
- [ ] Redis being down leaves every endpoint working, with a logged warning.
- [ ] `metricVisibility.middleware.ts` is deleted and nothing regressed.

### Tests

- `backend/tests/integration/cache.test.ts`: hit/miss/bypass per role; invalidation after a write; Redis-down fallback.
- `backend/tests/unit/cacheKeys.test.ts`: two roles never share a key for the same range.

### Out of scope

Multi-tier caching or stale-while-revalidate.

### Files

`backend/src/cache/*`, `backend/src/middleware/metricVisibility.middleware.ts` (delete),
`backend/src/modules/dashboard/*`, `backend/src/modules/monitoring/*`,
`backend/src/modules/events/events.service.ts`, `frontend/src/features/dashboard/components/DashboardFilterBar.tsx`.

---

## US-17 — Push summary aggregation into SQL

**As an** engineer responsible for this service
**I want** summaries computed by the database
**so that** response time and memory stop scaling with row count.

### Current behaviour

Two hot spots, both flagged in the existing risk register:

1. `eventsService.getSummaryByType` (`events.service.ts:38-53`) loops over all 11
   `EventType` values and calls `eventsRepository.findMany` for each — and `findMany`
   itself runs a `findMany` **plus** a `count`. That is **22 queries** to produce 11
   integers, and it fetches 25 rows per type that are then thrown away.
2. `auditService.summaryByAction` / `summaryByActor` / `summaryOverTime`
   (`audit.service.ts:52-91`) each call `list({ pageSize: 10_000 })` and group in Node
   with `.reduce()`. Three endpoints, three separate 10,000-row fetches, all
   deserialised through Prisma into JS objects.

Also `dashboardRepository.getEventsByType` (`dashboard.repository.ts:22-36`) runs 11
`count` queries where one `GROUP BY` would do.

`dashboardRepository` already demonstrates the right technique — `getEventsOverTime`,
`getActiveUsersOverTime`, and `getErrorRateOverTime` use parameterised `$queryRaw` with
`date_trunc` and `COUNT(*) FILTER (WHERE …)`. Copy that.

### Scope

1. Rewrite `getEventsByType` as one `GROUP BY "eventType"`.
2. Rewrite `eventsService.getSummaryByType` to use it. Decide whether zero-count types
   should appear in the output — the current implementation returns them
   (`events.service.ts:41-52`) while `dashboardRepository.getEventsByType:35` filters
   them out. **The two disagree today.** Pick one, make both consistent, and say which in
   the PR.
3. Move the three audit summaries into repository methods using `GROUP BY action`,
   `GROUP BY actorId` (joined to `User` for the email), and `GROUP BY date_trunc('day', "createdAt")`.
4. `summaryByActor` should return the **top 20** by count, not every actor. The chart
   cannot render hundreds of bars usefully.
5. Add the indexes the new queries need and verify with `EXPLAIN ANALYZE`. Paste
   before/after plans and timings in the PR.
6. Keep every response shape byte-identical. This is a pure refactor — the frontend must
   not change at all.

### Definition of done

- [ ] `GET /api/events/summary/by-type` issues one database query (verify with Prisma query logging).
- [ ] Each audit summary endpoint issues one query.
- [ ] Responses are identical to the previous implementation for the seeded dataset — assert this with a test that captures current output as a fixture *before* refactoring.
- [ ] Measured improvement documented in the PR with real numbers.
- [ ] No frontend file changed.

### Tests

- Fixture-based equivalence tests written against the current implementation first, then re-run against the new one.
- A large-range test (365 days) asserting the response completes well within a fixed budget.

### Out of scope

Materialised views. US-12 covers pre-aggregation.

### Files

`backend/src/modules/events/{events.service,events.repository}.ts`,
`backend/src/modules/audit/{audit.service,audit.repository}.ts`,
`backend/src/modules/dashboard/dashboard.repository.ts`, `backend/prisma/schema.prisma` (indexes).

---

## US-18 — Distributed rate limiting done properly

**As a** platform operator
**I want** rate limiting that survives multiple instances and tells clients when to retry
**so that** the limit is real and clients can behave well.

### Current behaviour

`rateLimit.middleware.ts:7-32` keeps a module-level `Map<ip, { count, windowStart }>`.
Problems:

- **Per-process.** Two API instances = double the effective limit. It resets on deploy.
- **Unbounded memory.** Entries are never evicted; every distinct IP is remembered forever.
- **Wrong error code.** It throws `AppError(ERROR_CODES.FORBIDDEN, …, 429)` — status 429
  with a body saying `FORBIDDEN`. A client matching on `error.code` cannot distinguish
  rate limiting from a permission failure.
- **No `Retry-After` header**, so clients can only guess.
- **One global limit** for everything: login attempts and dashboard polls share a budget.
- **Keyed by IP only**, so all users behind one office NAT share a bucket.

### Scope

1. Add `ERROR_CODES.RATE_LIMITED` and use it, keeping status 429.
2. Reimplement on Redis with a sliding window (sorted set of timestamps per key, or a
   fixed-window `INCR` + `EXPIRE` — the simpler one is fine, document the choice).
3. Key by `userId` when authenticated, falling back to IP for anonymous requests. **This
   requires moving the rate limiter after `authMiddleware` in `app.ts:31-33`** — note
   that ordering change explicitly in the PR.
4. Per-route tiers via a factory: `rateLimit({ points, windowMs })`.
   - `POST /api/auth/login` and `/register`: 5 per 15 minutes **per IP** (brute-force
     protection must stay IP-based).
   - `POST /api/exports`: 10 per hour per user.
   - Everything else: the existing global default from `env`.
5. Emit `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and
   `Retry-After` on a 429.
6. **Fail open** if Redis is unavailable — allow the request and log a warning. A dead
   cache must not take down the API. Say why you chose fail-open (availability over
   enforcement) in the PR.
7. Frontend: handle 429 in `apiClient` with a clear "Too many requests, retry in Ns"
   message; do not let TanStack Query's retry hammer a limited endpoint.

### Definition of done

- [ ] Six failed logins from one IP return 429 with `error.code === "RATE_LIMITED"` and a `Retry-After` header.
- [ ] The limit is shared across two locally-run API instances pointed at the same Redis.
- [ ] Authenticated users behind the same IP get independent budgets.
- [ ] Stopping Redis lets requests through, with a warning logged.
- [ ] Rate-limit headers are present on normal responses.

### Tests

- `backend/tests/integration/rateLimit.test.ts`: N+1 requests → 429; header values decrement correctly; per-user isolation; Redis-down fail-open; login limiter is IP-based even when authenticated.

### Out of scope

WAF-level protection and IP reputation.

### Files

`backend/src/middleware/rateLimit.middleware.ts`, `backend/src/shared/errors/errorCodes.ts`,
`backend/src/app.ts`, route files needing tiers, `frontend/src/api/client.ts`.

---

## US-19 — Make monitoring metrics real

**As an** engineering admin
**I want** the monitoring dashboard to reflect this application's actual behaviour
**so that** the charts mean something outside of seeded data.

### Current behaviour

`MonitoringMetric` rows are written by exactly two things: the seed
(`seed.ts:96-126`) and a manual `POST /api/monitoring/metrics`. The application itself
never records its own latency, error rate, cache hit rate, or DB query time. So the
engineering dashboard charts synthetic numbers forever, and
`kpiService`'s `averageApiLatencyMs` (`kpi.service.ts:47`) is a seeded constant.

`requestLoggerMiddleware` already measures duration and status per request
(`requestLogger.middleware.ts:12-21`) — it just logs and discards them.

Also note: `POST /api/monitoring/metrics` is guarded by `monitoring:view`
(`monitoring.routes.ts:11`), a **read** permission gating a **write**. Same problem on
`POST /api/events/track` (`events.routes.ts:11`). Fix both here.

### Scope

1. Add `monitoring:write` and `events:write` permissions. Grant `monitoring:write` to
   `SYSTEM_ADMIN` and `ENGINEERING_ADMIN`; grant `events:write` to every role that can
   act in the product. Re-guard the two POST routes. **This is a breaking permission
   change** — update the frontend permission mirror from US-01 and the tests.
2. Add a metrics collector that batches in memory and flushes to `MonitoringMetric`
   every 30 seconds (or every 100 samples, whichever first). Per-request inserts would
   double the write load of the API — do not do that.
3. Record from `requestLoggerMiddleware`: `API_LATENCY` (duration, tagged with route
   pattern and method) and `ERROR_RATE` (derived from status ≥ 500 over the flush window).
   Use the **route pattern** (`/api/events/:id`), not the raw URL, or you will create a
   unique metric name per id.
4. Record `DB_QUERY_TIME` via Prisma middleware (`prisma.$use` / client extension) —
   average query duration per flush window.
5. Record `CACHE_HIT_RATE` from the counters added in US-16.
6. Record `JOB_FAILURE_RATE` and `QUEUE_DEPTH` from the export worker on each job completion.
7. Make it switchable: `METRICS_ENABLED` in `config/env.ts`, default true, off in tests
   so the suite doesn't write metric rows.
8. Add a retention job that deletes `MonitoringMetric` rows older than
   `METRICS_RETENTION_DAYS` (default 30) — this table grows fastest of all.

### Definition of done

- [ ] Clicking around the app for a minute produces `API_LATENCY` rows with real route tags.
- [ ] The engineering dashboard's latency chart shows a spike after you deliberately slow an endpoint.
- [ ] Metric writes are batched — verify the insert count is far below the request count.
- [ ] `METRICS_ENABLED=false` produces no metric rows and no errors.
- [ ] Metrics collection adds no measurable latency to a request (measure and report).
- [ ] The two POST routes now require write permissions, and a `READ_ONLY` user cannot record metrics.

### Tests

- `backend/tests/integration/metricsCollector.test.ts`: flush writes the expected rows; disabled flag writes nothing; route patterns are normalised (`/api/events/abc-123` → `/api/events/:id`).
- Permission tests for the two re-guarded routes across all seven roles.

### Out of scope

OpenTelemetry / Prometheus export. Note as a natural follow-up.

### Files

`backend/src/shared/metrics/collector.ts` (new), `backend/src/middleware/requestLogger.middleware.ts`,
`backend/src/db/prisma.ts`, `backend/src/shared/permissions.ts`,
`backend/src/modules/{events,monitoring}/*.routes.ts`, `backend/src/config/env.ts`,
`backend/src/jobs/metricsRetention.processor.ts` (new).

---

## US-20 — Database-backed tests and a CI that can run them

**As a** team
**I want** integration tests that exercise real Postgres and real Redis in CI
**so that** we can refactor without fear.

### Current behaviour

Five test files exist in total. `backend/tests/integration/health.test.ts` is one
assertion against `/health`. Nothing touches the database, because CI
(`.github/workflows/ci.yml`) starts no services — it runs `prisma generate` against a
connection string that points at nothing, then typechecks, tests, and builds.

Every story above asks for integration tests. **This story unblocks all of them**, so if
you are working the pack in order, consider doing it first and moving it to Tier 1.

### Scope

**CI**

1. Add `services: postgres:16-alpine` and `redis:7-alpine` to the workflow with health
   checks, matching `docker-compose.yml`.
2. Run `prisma migrate deploy` against the service database before tests.
3. Split into jobs: `lint-and-typecheck`, `test-backend`, `test-frontend`, `build`, and
   a Playwright `e2e` job that starts backend + frontend, seeds, and runs the specs.
4. Upload Playwright traces and screenshots as artifacts on failure.
5. Cache `~/.npm` and the Prisma engines to keep runs quick.

**Test infrastructure**

6. `backend/tests/helpers/db.ts`: connect, truncate all tables between tests
   (`TRUNCATE … RESTART IDENTITY CASCADE` is much faster than `deleteMany` per model),
   and disconnect in `afterAll`.
7. `backend/tests/helpers/factories.ts`: `createUser({ role })`,
   `createTrackedEvents({ count, eventType, occurredAt })`, `createAuditEvent(…)`,
   `createExportJob(…)`. Small, explicit, no faker.
8. `backend/tests/helpers/auth.ts`: `authHeaderFor(role)` minting a real access token via
   `signAccessToken`, so tests exercise the true middleware chain instead of stubbing `req.user`.
9. `vitest.setup.ts`: set `NODE_ENV=test`, point at a separate `analytics_admin_test`
   database, and disable metrics collection.

**The tests themselves**

10. **An RBAC contract test.** One table of `[method, path, requiredPermission]` for
    every route in the app, crossed with all seven roles — 7 × ~40 assertions generated
    from `it.each`. Adding a route without adding it to the table should fail the suite.
    This single test is worth more than everything else in this story.
11. Happy-path integration coverage per module: auth (login → me → refresh → logout),
    events (track → list → detail), dashboard (each endpoint with a known seeded range),
    exports (create → complete → download), audit, monitoring.
12. Frontend: a `renderWithProviders` helper (QueryClient + MemoryRouter + auth store
    seeded with a role) and component tests for `DataTable`, `KpiCardGrid`, and the
    guards.
13. One real Playwright flow: log in as ops manager → change the date range → open the
    event log → open an event → create an export → download it.

### Definition of done

- [ ] `npm run test` passes locally against a live Postgres and Redis.
- [ ] CI runs migrations and the full suite on every PR, green.
- [ ] Tests are order-independent and can run repeatedly without manual cleanup.
- [ ] The RBAC contract test covers every mounted route; deleting a `requirePermission` call fails a test.
- [ ] Playwright runs in CI with artifacts on failure.
- [ ] Total CI wall time stays under 10 minutes.

### Tests

This story *is* tests. The meta-check: temporarily remove `requirePermission("audit:view")`
from `audit.routes.ts` and confirm the suite goes red.

### Out of scope

Coverage thresholds and mutation testing. Get the harness working first.

### Files

`.github/workflows/ci.yml`, `backend/tests/helpers/*` (new),
`backend/tests/integration/*` (new), `backend/vitest.setup.ts`,
`frontend/src/test/helpers/*` (new), `frontend/src/test/e2e/*`.

---

## Appendix — story dependencies

```
US-20 (test harness)  ─── unblocks integration tests in every other story
US-01 (permissions)   ─── US-07, US-19 extend the permission matrix
US-02 (dates)         ─── US-12, US-14 depend on correct range semantics
US-03 (error states)  ─── every frontend story renders through QueryBoundary
US-05 (pagination)    ─── US-07 reuses the Pagination component
US-09 (retry fix)     ─── US-15 (queue depth is polluted by the orphan rows)
US-16 (cache metrics) ─── US-19 (cache hit rate needs the counters)
US-19 (real metrics)  ─── US-13 (alerting on seed data is meaningless)
```

Suggested first four, in order: **US-20 → US-01 → US-02 → US-03.** That gives you a
working test harness, one source of truth for access, correct date semantics, and a UI
that tells the truth when something fails — which is the foundation everything else
sits on.
