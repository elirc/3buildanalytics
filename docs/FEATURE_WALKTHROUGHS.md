# Feature Walkthroughs

Each walkthrough names the real files in order. Open them side by side as you
read; every symbol here exists in the code.

## Track Event Flow

1. `POST /api/events/track` is registered in
   `backend/src/modules/events/events.routes.ts` — note the comment above it:
   this write used to be gated by `events:view`, and the comment records why
   that conflation was a bug. It now requires `events:write`, which
   `EXECUTIVE_VIEWER` and `READ_ONLY` deliberately lack.
2. `validate(trackEventSchema)` rejects malformed payloads before the
   controller runs (`events.schemas.ts`).
3. `eventsController.track` → `eventsService.track` → `events.repository.ts`
   writes the `TrackedEvent` row.
4. From that moment the row is visible to `GET /api/events` (paginated raw
   log) and to the `summary/by-type` and `summary/over-time` aggregates.

## KPI Dashboard Flow

1. Filter state lives in the URL; TanStack Query keys include the same
   date range, so a changed filter is a different cache entry on *both* ends.
2. `GET /api/dashboard/kpi-summary` (`dashboard.routes.ts`) — the whole
   router is wrapped in `requirePermission("dashboard:view")` once, via
   `dashboardRouter.use(...)`, instead of per-route.
3. `kpiService.getSummary` (`kpi.service.ts`):
   - `parseDateRange(..., { maxRangeDays: 365 })` — validation at the service
     boundary;
   - cache lookup via `cacheKeys.kpiSummary({ role, startDate, endDate,
     compare })` — the **role is part of the key**, and a `compare` request
     gets its own key because the payload shape differs;
   - on a miss, `summarise()` runs, `applyMetricVisibility(role, ...)` strips
     metrics the role may not see, and the result is cached for 300 seconds;
   - the response carries `_cache: "HIT" | "MISS" | "BYPASS"` so you can see
     cache behaviour in the network tab without guessing.
4. With `compare=true`, current and previous windows run in a single
   `Promise.all` — sequential execution would double the latency of a
   glance-at-a-number feature.

## Chart Data Flow

Charts never aggregate client-side. Each chart has its own endpoint in
`dashboard.routes.ts` (`/events-over-time`, `/events-by-type`,
`/active-users`, `/error-rate`, `/conversion-funnel`, `/recent-activity`),
all validated by `dashboardRangeSchema`, all returning buckets the chart
library renders directly. Long windows (≥ `SNAPSHOT_MIN_DAYS` = 30 days) can
be served from pre-computed snapshots (`metricSnapshot.service.ts`); short
interactive ranges always query live because freshness matters more there.

## Audit Dashboard Flow

Audit routes require `audit:view` — of the seven roles, only
`SYSTEM_ADMIN` and `AUDIT_VIEWER` have it (check
`PERMISSIONS` in `backend/src/shared/permissions.ts` — the matrix is the
single source of truth). Summaries are grouped server-side
(`audit.repository.ts`); raw records stay paginated.

## Monitoring Flow

`MonitoringMetric` is ingested separately from tracked events — system
health, not product usage. `monitoringRollup.processor.ts` and
`metricsRetention.processor.ts` in `backend/src/jobs/` show the lifecycle:
raw metrics roll up, old raw rows age out.

## Export Flow

1. The frontend calls create on the exports module; `exports.service.ts`
   checks permissions, then **estimates the row count before inserting the
   job row** (`estimateExportRows`).
2. `MAX_SYNC_EXPORT_ROWS = 10_000` splits the paths: at or under it, the CSV
   is generated inline; over it, the job is queued to BullMQ and
   `backend/src/jobs/export.processor.ts` picks it up in the worker process
   (`src/worker.ts` — a separate process from the API).
3. `estimate()` returns `{ rowCount, willQueue, maxSyncRows }`, so the UI can
   warn before the user commits to a big export.
4. Failures land in the `ExportJob` row's `errorMessage` — the first place to
   look when an export sits in a failed state (see `docs/DEBUGGING_GUIDE.md`).
