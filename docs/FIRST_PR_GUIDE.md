# First PR Guide

## Safe First Changes

Each of these is small, touches one layer at a time, and has a check that
tells you it worked.

1. **Add a KPI card sourced from an existing endpoint.**
   `kpi.service.ts` already returns more metrics than every page shows
   (see `COMPARABLE_KEYS` for the list). Add one to a dashboard page's card
   row in `frontend/src/features/dashboard/pages/`.
   **Check**: the card renders with real data, and changing the date range
   re-fetches it (watch the query key change in React Query devtools).
2. **Improve a dashboard empty state.** Pick a chart, seed-free date range
   (e.g. a week before the seed window), and replace the blank render with a
   message. **Check**: the old range still renders bars; the empty range
   shows your message, not a zero-height chart.
3. **Add one backend validation rule.** For example, tighten a `pageSize`
   bound in `events.schemas.ts`. **Check**: a request over the bound returns
   400 with a Zod message, and the existing tests still pass
   (`npm run test -w backend`).
4. **Add one unit test around a helper.** `percent` in
   `backend/src/shared/utils/aggregations.ts` or the date-range parser in
   `shared/utils/dates.ts` (what happens at exactly 365 days? at 366?).
   **Check**: `npm run test -w backend` goes up by your assertion count.
5. **Add one audit record to an existing admin flow.** Find a mutation that
   doesn't write an `AuditEvent` yet, and add the write *in the service, in
   the same place the module's other audit writes happen*.
   **Check**: the action shows up in the audit dashboard for an
   `AUDIT_VIEWER` login.

## Workflow

1. Read the relevant doc for the area you are touching
   (`docs/BACKEND_TOUR.md` or `docs/FRONTEND_TOUR.md` names the entry files).
2. Trace the current path end to end before changing it — the walkthroughs
   in `docs/FEATURE_WALKTHROUGHS.md` are the templates.
3. Make the smallest coherent change that still proves the pattern.
4. Add or adjust tests.
5. Run `npm run typecheck`, `npm run test`, `npm run build` before the PR.

## Review Mindset

Reviewers here will ask, in roughly this order:

- Is the permission right? (A write behind a `:view` permission has slipped
  through once already — the comment in `events.routes.ts` is the scar.)
- Is the date range validated, and does the cache key include everything
  that changes the payload (role, range, compare, interval)?
- Did raw rows cross a boundary where an aggregate should have?
- Would the next engineer understand this from the diff alone?
