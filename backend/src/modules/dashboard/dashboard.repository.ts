import { EventType, MonitoringMetricType, Prisma } from "@prisma/client";

import { prisma } from "../../db/prisma.js";

export const dashboardRepository = {
  async countTrackedEvents(where: Prisma.TrackedEventWhereInput) {
    return prisma.trackedEvent.count({ where });
  },

  async countDistinctActors(startDate: Date, endDate: Date) {
    const result = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(DISTINCT "actorId")::bigint AS count
      FROM "TrackedEvent"
      WHERE "actorId" IS NOT NULL
        AND "occurredAt" >= ${startDate}
        AND "occurredAt" <= ${endDate}
    `;

    return Number(result[0]?.count ?? 0n);
  },

  /**
   * Counts per event type in one query.
   *
   * Was eleven separate COUNT queries — one per enum value — fired in parallel
   * and awaited together. One GROUP BY does the same work in a single round
   * trip and lets the index on eventType do its job.
   *
   * @param includeZeroes when true, types with no events are returned as 0.
   *        The two callers genuinely disagreed about this: the dashboard chart
   *        wanted only what occurred, the events summary wanted the full
   *        vocabulary. Rather than silently pick one, the difference is now a
   *        parameter and both existing contracts are preserved.
   */
  async getEventsByType(startDate: Date, endDate: Date, options?: { includeZeroes?: boolean }) {
    const rows = await prisma.trackedEvent.groupBy({
      by: ["eventType"],
      where: { occurredAt: { gte: startDate, lte: endDate } },
      _count: { _all: true }
    });

    const counts = new Map(rows.map((row) => [row.eventType, row._count._all]));

    if (options?.includeZeroes) {
      return Object.values(EventType).map((eventType) => ({
        eventType,
        count: counts.get(eventType) ?? 0
      }));
    }

    return Object.values(EventType)
      .map((eventType) => ({ eventType, count: counts.get(eventType) ?? 0 }))
      .filter((item) => item.count > 0);
  },

  async getEventsOverTime(startDate: Date, endDate: Date, interval: "day" | "week" = "day") {
    const rows = await prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
      SELECT date_trunc(${interval}, "occurredAt") AS bucket, COUNT(*)::bigint AS count
      FROM "TrackedEvent"
      WHERE "occurredAt" >= ${startDate}
        AND "occurredAt" <= ${endDate}
      GROUP BY bucket
      ORDER BY bucket ASC
    `;

    return rows.map((row) => ({
      date: row.bucket.toISOString().slice(0, 10),
      count: Number(row.count)
    }));
  },

  async getActiveUsersOverTime(startDate: Date, endDate: Date, interval: "day" | "week" = "day") {
    const rows = await prisma.$queryRaw<Array<{ bucket: Date; activeUsers: bigint }>>`
      SELECT date_trunc(${interval}, "occurredAt") AS bucket, COUNT(DISTINCT "actorId")::bigint AS "activeUsers"
      FROM "TrackedEvent"
      WHERE "actorId" IS NOT NULL
        AND "occurredAt" >= ${startDate}
        AND "occurredAt" <= ${endDate}
      GROUP BY bucket
      ORDER BY bucket ASC
    `;

    return rows.map((row) => ({
      date: row.bucket.toISOString().slice(0, 10),
      activeUsers: Number(row.activeUsers)
    }));
  },

  async getErrorRateOverTime(startDate: Date, endDate: Date, interval: "day" | "week" = "day") {
    const rows = await prisma.$queryRaw<Array<{ bucket: Date; total: bigint; errors: bigint }>>`
      SELECT
        date_trunc(${interval}, "occurredAt") AS bucket,
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE "eventType" = 'API_ERROR')::bigint AS errors
      FROM "TrackedEvent"
      WHERE "occurredAt" >= ${startDate}
        AND "occurredAt" <= ${endDate}
      GROUP BY bucket
      ORDER BY bucket ASC
    `;

    return rows.map((row) => ({
      date: row.bucket.toISOString().slice(0, 10),
      totalEvents: Number(row.total),
      failedEvents: Number(row.errors),
      errorRate: Number(row.total) === 0 ? 0 : Number(row.errors) / Number(row.total)
    }));
  },

  async getConversionFunnel(startDate: Date, endDate: Date) {
    const [signups, logins, featureUse, exports] = await Promise.all([
      prisma.trackedEvent.count({
        where: {
          eventType: EventType.USER_SIGNED_UP,
          occurredAt: { gte: startDate, lte: endDate }
        }
      }),
      prisma.trackedEvent.count({
        where: {
          eventType: EventType.USER_LOGGED_IN,
          occurredAt: { gte: startDate, lte: endDate }
        }
      }),
      prisma.trackedEvent.count({
        where: {
          eventType: EventType.FEATURE_USED,
          occurredAt: { gte: startDate, lte: endDate }
        }
      }),
      prisma.trackedEvent.count({
        where: {
          eventType: EventType.CSV_EXPORTED,
          occurredAt: { gte: startDate, lte: endDate }
        }
      })
    ]);

    const base = signups || 1;

    return [
      { stage: "Signed up", count: signups, conversionRate: signups / base },
      { stage: "Logged in", count: logins, conversionRate: logins / base },
      { stage: "Used feature", count: featureUse, conversionRate: featureUse / base },
      { stage: "Exported CSV", count: exports, conversionRate: exports / base }
    ];
  },

  async getAverageLatency(startDate: Date, endDate: Date) {
    const result = await prisma.monitoringMetric.aggregate({
      where: {
        metricType: MonitoringMetricType.API_LATENCY,
        recordedAt: { gte: startDate, lte: endDate }
      },
      _avg: {
        value: true
      }
    });

    return result._avg.value ?? 0;
  },

  async getRecentActivity(startDate: Date, endDate: Date) {
    return prisma.trackedEvent.findMany({
      where: {
        occurredAt: { gte: startDate, lte: endDate }
      },
      take: 20,
      orderBy: { occurredAt: "desc" }
    });
  },

  async getMonitoringMetricAverage(metricType: MonitoringMetricType, startDate: Date, endDate: Date) {
    const result = await prisma.monitoringMetric.aggregate({
      where: {
        metricType,
        recordedAt: { gte: startDate, lte: endDate }
      },
      _avg: {
        value: true
      }
    });

    return result._avg.value ?? 0;
  }
};
