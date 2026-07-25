import { cacheKeys } from "../../cache/cacheKeys.js";
import { cacheService } from "../../cache/cache.service.js";
import { applyMetricVisibility } from "../../shared/permissions.js";
import { percent } from "../../shared/utils/aggregations.js";
import { parseDateRange } from "../../shared/utils/dates.js";
import { dashboardRepository } from "./dashboard.repository.js";
import { metricSnapshotService } from "./metricSnapshot.service.js";

/**
 * Ranges shorter than this always use live queries: the snapshot path only
 * pays off over long windows, and short ranges are the common interactive case
 * where freshness matters most.
 */
const SNAPSHOT_MIN_DAYS = 30;

/** Metrics that get a previous-period comparison. `_meta` is not one of them. */
const COMPARABLE_KEYS = [
  "totalEvents",
  "activeUsers",
  "failedEvents",
  "errorRate",
  "csvExports",
  "adminActions",
  "averageApiLatencyMs",
  "backgroundJobFailures"
] as const;

export const kpiService = {
  async getSummary(input: {
    role: Express.User["role"];
    startDate: string;
    endDate: string;
    refresh?: boolean;
    compare?: boolean;
  }) {
    const range = parseDateRange(input.startDate, input.endDate, { maxRangeDays: 365 });
    const key = cacheKeys.kpiSummary({
      role: input.role,
      startDate: input.startDate,
      endDate: input.endDate,
      // The comparison payload is a different shape, so it needs a different
      // key. Sharing one would serve a flat summary to a caller asking for
      // deltas, or the reverse.
      compare: input.compare
    });

    if (!input.refresh) {
      const cached = await cacheService.get<Record<string, unknown>>(key);
      if (cached) {
        return cached;
      }
    }

    if (!input.compare) {
      const current = await summarise(range.startDate, range.endDate);
      const visible = applyMetricVisibility(input.role, current);
      await cacheService.set(key, visible, 300);
      return visible;
    }

    const previous = previousPeriod(range.startDate, range.endDate);

    // Both windows in one round of parallel work. Running them in sequence
    // would double the latency of a feature whose whole appeal is a glance.
    const [current, prior] = await Promise.all([
      summarise(range.startDate, range.endDate),
      summarise(previous.startDate, previous.endDate)
    ]);

    // Visibility is applied to BOTH halves before they are combined. Filtering
    // only the current values would leak a hidden metric through its own
    // `previous` field — the kind of gap that appears when a feature is added
    // beside an access rule instead of through it.
    const visibleCurrent = applyMetricVisibility(input.role, current);
    const visiblePrior = applyMetricVisibility(input.role, prior);

    const result: Record<string, unknown> = {
      _meta: {
        source: visibleCurrent._meta.source,
        compare: "previous_period",
        previousPeriod: {
          startDate: previous.startDate.toISOString().slice(0, 10),
          endDate: previous.endDate.toISOString().slice(0, 10)
        }
      }
    };

    for (const metric of COMPARABLE_KEYS) {
      if (!(metric in visibleCurrent)) {
        continue;
      }

      const value = visibleCurrent[metric] as number;
      const previousValue = (visiblePrior as Record<string, unknown>)[metric] as number | undefined;

      result[metric] = {
        value,
        previous: previousValue ?? null,
        changePercent: changePercent(value, previousValue)
      };
    }

    await cacheService.set(key, result, 300);
    return result;
  }
};

/**
 * The window of equal length immediately before this one.
 *
 * Ends one millisecond before the current window starts, so the two never
 * overlap — an overlapping "previous" would double-count the boundary and make
 * every delta slightly wrong in a way nobody would notice.
 */
function previousPeriod(start: Date, end: Date) {
  const span = end.getTime() - start.getTime();
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - span);
  return { startDate: previousStart, endDate: previousEnd };
}

/**
 * Percentage change, or null when it cannot be expressed.
 *
 * Growth from zero is not "infinite percent" — it is undefined, and rendering
 * `Infinity%` in a dashboard cell is how you lose a reader's trust in every
 * other number on the page.
 */
function changePercent(value: number, previous: number | undefined) {
  if (previous === undefined || previous === 0) {
    return null;
  }

  return Number((((value - previous) / previous) * 100).toFixed(2));
}

async function summarise(start: Date, end: Date) {
  const snapshot = await trySnapshotSummary(start, end);
  return snapshot ?? (await liveSummary(start, end));
}

/**
 * Reads pre-aggregated snapshots when they can answer the question completely.
 *
 * Three conditions, all necessary:
 *
 * 1. The range must be long enough to be worth it.
 * 2. It must end strictly before today. A range including today mixes complete
 *    snapshot days with an incomplete current one, and reporting that as a
 *    total would quietly under-count. Falling back to live for those ranges is
 *    the simpler and more honest of the two options considered — the other was
 *    summing snapshots for whole days and querying live for today, which is
 *    faster but has two code paths producing one number.
 * 3. Every day in the range must actually have a snapshot, or the sum is a
 *    partial answer wearing a complete one's clothes.
 *
 * Returns null when any of those fail, and the caller runs the live query.
 */
async function trySnapshotSummary(start: Date, end: Date) {
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days < SNAPSHOT_MIN_DAYS) {
    return null;
  }

  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  if (end.getTime() >= startOfToday.getTime()) {
    return null;
  }

  const summed = await metricSnapshotService.sumRange(start, end);
  if (!summed) {
    return null;
  }

  return {
    totalEvents: summed.totalEvents,
    activeUsers: summed.activeUsers,
    failedEvents: summed.failedEvents,
    errorRate: percent(summed.failedEvents, summed.totalEvents),
    csvExports: summed.csvExports,
    // Not rolled up: adminActions and latency are not part of the daily
    // snapshot set, so they come back live even on the snapshot path.
    adminActions: await dashboardRepository.countTrackedEvents({
      eventType: "ADMIN_ACTION",
      occurredAt: { gte: start, lte: end }
    }),
    averageApiLatencyMs: Math.round(await dashboardRepository.getAverageLatency(start, end)),
    backgroundJobFailures: summed.backgroundJobFailures,
    _meta: { source: "snapshot" as const }
  };
}

async function liveSummary(start: Date, end: Date) {
  const window = { gte: start, lte: end };

  const [
    totalEvents,
    failedEvents,
    csvExports,
    adminActions,
    activeUsers,
    averageApiLatencyMs,
    backgroundJobFailures
  ] = await Promise.all([
    dashboardRepository.countTrackedEvents({ occurredAt: window }),
    dashboardRepository.countTrackedEvents({ eventType: "API_ERROR", occurredAt: window }),
    dashboardRepository.countTrackedEvents({ eventType: "CSV_EXPORTED", occurredAt: window }),
    dashboardRepository.countTrackedEvents({ eventType: "ADMIN_ACTION", occurredAt: window }),
    dashboardRepository.countDistinctActors(start, end),
    dashboardRepository.getAverageLatency(start, end),
    dashboardRepository.countTrackedEvents({
      eventType: "BACKGROUND_JOB_FAILED",
      occurredAt: window
    })
  ]);

  return {
    totalEvents,
    activeUsers,
    failedEvents,
    errorRate: percent(failedEvents, totalEvents),
    csvExports,
    adminActions,
    averageApiLatencyMs: Math.round(averageApiLatencyMs),
    backgroundJobFailures,
    _meta: { source: "live" as const }
  };
}
