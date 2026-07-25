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

export const kpiService = {
  async getSummary(input: {
    role: Express.User["role"];
    startDate: string;
    endDate: string;
    refresh?: boolean;
  }) {
    const range = parseDateRange(input.startDate, input.endDate, { maxRangeDays: 365 });
    const key = cacheKeys.kpiSummary({
      role: input.role,
      startDate: input.startDate,
      endDate: input.endDate
    });

    if (!input.refresh) {
      const cached = await cacheService.get<Record<string, unknown>>(key);
      if (cached) {
        return cached;
      }
    }

    const snapshot = await trySnapshotSummary(range.startDate, range.endDate);
    const result = snapshot ?? (await liveSummary(range.startDate, range.endDate));

    const visible = applyMetricVisibility(input.role, result);

    await cacheService.set(key, visible, 300);
    return visible;
  }
};

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
