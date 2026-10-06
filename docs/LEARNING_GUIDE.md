# Learning Guide

## Why This Project Matters

Internal dashboards are not "just charts." They are trust systems. A team uses
them to make decisions, triage incidents, answer audits, and spot operational
drift. Everything interesting in this codebase follows from that: the numbers
must be right, fast, and only visible to the roles allowed to see them.

## Core Lessons

- Read-heavy systems need different design than CRUD apps — compare the
  dashboard module (aggregates, caching, snapshots) to the users module
  (plain CRUD).
- Aggregation belongs on the backend: every chart endpoint in
  `backend/src/modules/dashboard/dashboard.routes.ts` returns bucketed,
  chart-ready data.
- Date-range filters shape everything: `parseDateRange` in
  `backend/src/shared/utils/dates.ts` caps ranges at 365 days, and the same
  `startDate`/`endDate` pair appears in URL params, Zod schemas, cache keys,
  and SQL.
- Role-based visibility is enforced server-side twice: route entry
  (`requirePermission`) and payload shaping (`applyMetricVisibility` in
  `backend/src/shared/permissions.ts`).
- CSV export is part product feature, part security feature — see the
  sanitization unit tests and the permission checks in
  `backend/src/modules/exports/exports.service.ts`.
- Seed volume matters because fake-small datasets hide query problems.

## Study Path

Each step names the files and ends with a check you can actually run or
answer. Do them in order — later steps assume the earlier mental model.

1. **The three event streams.** Read the `TrackedEvent`, `AuditEvent`, and
   `MonitoringMetric` models in `backend/prisma/schema.prisma`, then
   `docs/DATA_MODEL_GUIDE.md` for why they are separate.
   **Check**: for each stream, name its permission (`events:view`,
   `audit:view`, `monitoring:view`) and find the route file that enforces it.
2. **One date range, end to end.** Start at a dashboard page's URL params in
   the frontend, then follow `startDate`/`endDate` through
   `dashboard.schemas.ts` (validation), `kpi.service.ts` (parsing and
   caching), and `dashboard.repository.ts` (SQL).
   **Check**: explain where an invalid range (end before start, or > 365
   days) is rejected, and what status code the client sees.
3. **The KPI summary path.** Read `kpi.service.ts` top to bottom. Note
   `SNAPSHOT_MIN_DAYS = 30` (short ranges always query live) and
   `COMPARABLE_KEYS` (which metrics get previous-period deltas).
   **Check**: call `/api/dashboard/kpi-summary` twice with the same range
   and explain why the second response carries `_cache: "HIT"`; then explain
   what `refresh=true` changes (`_cache: "BYPASS"`).
4. **Cache keys as a correctness tool.** Read `backend/src/cache/cacheKeys.ts`.
   The role is part of every key.
   **Check**: describe the exact bug that would occur if `role` were removed
   from `kpiSummary`'s key but `applyMetricVisibility` still ran — which user
   would see whose numbers?
5. **Exports: sync vs queued.** Read `exports.service.ts`. The row estimate
   happens *before* the job row is inserted, and
   `MAX_SYNC_EXPORT_ROWS = 10_000` decides whether the export runs inline or
   goes to BullMQ (`backend/src/jobs/export.processor.ts`).
   **Check**: using `estimate()`'s return shape, say what `willQueue` is for
   a 9,000-row and a 11,000-row export, and where a queued job's failure
   message ends up (the `ExportJob` row's `errorMessage`).
6. **The permission matrix.** Read `PERMISSIONS` in
   `backend/src/shared/permissions.ts` and the comment above
   `POST /api/events/track` in `events.routes.ts` — it records a real past
   bug where a *write* was gated by a *view* permission.
   **Check**: name the two roles that cannot track events, and why.
