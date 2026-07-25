import { MetricType } from "@prisma/client";

import { prisma } from "../../db/prisma.js";
import { logInfo } from "../../shared/utils/logger.js";

/**
 * Daily pre-aggregation.
 *
 * The MetricSnapshot model has existed since the first migration and nothing
 * ever wrote to it — the processor was a three-line stub. A 365-day KPI request
 * therefore ran seven aggregate queries over the full TrackedEvent table every
 * time. Fine at seed scale, not fine later.
 *
 * One row per metric per UTC day. The unique constraint on
 * (metricKey, periodStart, periodEnd) plus upsert makes a re-run overwrite
 * rather than double-count, which matters because job retries are normal.
 */

export const SNAPSHOT_KEYS = {
  eventsTotal: "events.total",
  eventsErrors: "events.errors",
  activeUsers: "users.active",
  exportsCompleted: "exports.completed",
  jobsFailed: "jobs.failed"
} as const;

export interface DayBounds {
  start: Date;
  end: Date;
}

export function utcDayBounds(day: Date): DayBounds {
  const start = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0, 0)
  );
  const end = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 59, 59, 999)
  );
  return { start, end };
}

export const metricSnapshotService = {
  /** Computes and stores every snapshot for one UTC day. */
  async rollupDay(day: Date) {
    const { start, end } = utcDayBounds(day);
    const window = { gte: start, lte: end };

    const [total, errors, exportsCompleted, jobsFailed, activeUsers] = await Promise.all([
      prisma.trackedEvent.count({ where: { occurredAt: window } }),
      prisma.trackedEvent.count({ where: { eventType: "API_ERROR", occurredAt: window } }),
      prisma.trackedEvent.count({ where: { eventType: "CSV_EXPORTED", occurredAt: window } }),
      prisma.trackedEvent.count({ where: { eventType: "BACKGROUND_JOB_FAILED", occurredAt: window } }),
      countDistinctActors(start, end)
    ]);

    const rows: Array<{ key: string; value: number; type: MetricType }> = [
      { key: SNAPSHOT_KEYS.eventsTotal, value: total, type: MetricType.COUNT },
      { key: SNAPSHOT_KEYS.eventsErrors, value: errors, type: MetricType.COUNT },
      { key: SNAPSHOT_KEYS.activeUsers, value: activeUsers, type: MetricType.COUNT },
      { key: SNAPSHOT_KEYS.exportsCompleted, value: exportsCompleted, type: MetricType.COUNT },
      { key: SNAPSHOT_KEYS.jobsFailed, value: jobsFailed, type: MetricType.COUNT }
    ];

    for (const row of rows) {
      await prisma.metricSnapshot.upsert({
        where: {
          metricKey_periodStart_periodEnd: {
            metricKey: row.key,
            periodStart: start,
            periodEnd: end
          }
        },
        create: {
          metricKey: row.key,
          metricType: row.type,
          value: row.value,
          periodStart: start,
          periodEnd: end
        },
        update: { value: row.value }
      });
    }

    return { day: start.toISOString().slice(0, 10), metrics: rows.length };
  },

  /** Rolls up every whole day in a range, inclusive. Used by the backfill CLI. */
  async backfill(from: Date, to: Date) {
    const days: string[] = [];
    const cursor = utcDayBounds(from).start;
    const last = utcDayBounds(to).start;

    while (cursor.getTime() <= last.getTime()) {
      const result = await this.rollupDay(new Date(cursor));
      days.push(result.day);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    logInfo("metric_snapshot.backfill.completed", { days: days.length });
    return { days: days.length, first: days[0], last: days[days.length - 1] };
  },

  /**
   * Sums snapshots across whole days.
   *
   * Returns null when the range is not fully covered — a partially-covered
   * range would silently under-report, which is worse than being slow.
   */
  async sumRange(start: Date, end: Date) {
    const expectedDays = countUtcDays(start, end);

    const grouped = await prisma.metricSnapshot.groupBy({
      by: ["metricKey"],
      where: { periodStart: { gte: start }, periodEnd: { lte: end } },
      _sum: { value: true },
      _count: { _all: true }
    });

    if (grouped.length === 0) {
      return null;
    }

    const totalDays = grouped.find((row) => row.metricKey === SNAPSHOT_KEYS.eventsTotal)?._count._all ?? 0;
    if (totalDays < expectedDays) {
      return null;
    }

    const value = (key: string) =>
      Math.round(grouped.find((row) => row.metricKey === key)?._sum.value ?? 0);

    return {
      totalEvents: value(SNAPSHOT_KEYS.eventsTotal),
      failedEvents: value(SNAPSHOT_KEYS.eventsErrors),
      csvExports: value(SNAPSHOT_KEYS.exportsCompleted),
      backgroundJobFailures: value(SNAPSHOT_KEYS.jobsFailed),
      /**
       * Deliberately a *sum of daily distinct counts*, not a distinct count
       * over the range: an actor active on three days counts three times.
       * Distinct-over-range cannot be derived from daily rollups at all — you
       * would need a HyperLogLog sketch or the raw rows.
       *
       * kpiService only uses snapshots for ranges that exclude today, and
       * reports which source served the request, so this approximation is
       * visible rather than silent.
       */
      activeUsers: value(SNAPSHOT_KEYS.activeUsers)
    };
  }
};

async function countDistinctActors(start: Date, end: Date) {
  const result = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(DISTINCT "actorId")::bigint AS count
    FROM "TrackedEvent"
    WHERE "actorId" IS NOT NULL
      AND "occurredAt" >= ${start}
      AND "occurredAt" <= ${end}
  `;

  return Number(result[0]?.count ?? 0n);
}

function countUtcDays(start: Date, end: Date) {
  const first = utcDayBounds(start).start.getTime();
  const last = utcDayBounds(end).start.getTime();
  return Math.floor((last - first) / 86_400_000) + 1;
}
