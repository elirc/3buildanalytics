import { MonitoringMetricType, type Prisma } from "@prisma/client";

import { cacheKeys } from "../../cache/cacheKeys.js";
import { getQueueCounts } from "../../jobs/queue.js";
import { cacheService } from "../../cache/cache.service.js";
import { parseDateRange, toIsoDate } from "../../shared/utils/dates.js";
import { cacheInvalidator } from "../../cache/cacheInvalidator.js";
import { monitoringRepository } from "./monitoring.repository.js";

export const monitoringService = {
  async record(data: Prisma.MonitoringMetricCreateInput) {
    const metric = await monitoringRepository.create(data);
    await cacheInvalidator.onMonitoringMetric();
    return metric;
  },

  async getSummary(input: {
    role: Express.User["role"];
    startDate: string;
    endDate: string;
  }) {
    const range = parseDateRange(input.startDate, input.endDate, { maxRangeDays: 365 });
    const key = cacheKeys.monitoringSummary({
      role: input.role,
      startDate: input.startDate,
      endDate: input.endDate
    });

    const cached = await cacheService.get<{
      averageApiLatencyMs: number;
      averageErrorRate: number;
      averageJobFailureRate: number;
      averageCacheHitRate: number;
      averageDbQueryTimeMs: number;
      queueDepth: { pending: number; processing: number; failed: number; total: number };
    }>(key);
    if (cached) {
      return cached;
    }

    const [
      averageApiLatencyMs,
      averageErrorRate,
      averageJobFailureRate,
      averageCacheHitRate,
      averageDbQueryTimeMs,
      queueDepth
    ] = await Promise.all([
      monitoringRepository.aggregateAverage(MonitoringMetricType.API_LATENCY, range.startDate, range.endDate),
      monitoringRepository.aggregateAverage(MonitoringMetricType.ERROR_RATE, range.startDate, range.endDate),
      monitoringRepository.aggregateAverage(
        MonitoringMetricType.JOB_FAILURE_RATE,
        range.startDate,
        range.endDate
      ),
      monitoringRepository.aggregateAverage(
        MonitoringMetricType.CACHE_HIT_RATE,
        range.startDate,
        range.endDate
      ),
      monitoringRepository.aggregateAverage(
        MonitoringMetricType.DB_QUERY_TIME,
        range.startDate,
        range.endDate
      ),
      monitoringRepository.getQueueDepth()
    ]);

    const result = {
      averageApiLatencyMs: Math.round(averageApiLatencyMs),
      averageErrorRate,
      averageJobFailureRate,
      averageCacheHitRate,
      averageDbQueryTimeMs: Math.round(averageDbQueryTimeMs),
      queueDepth
    };

    await cacheService.set(key, result, 60);
    return result;
  },

  async getSeries(input: {
    metricType: MonitoringMetricType;
    startDate: string;
    endDate: string;
  }) {
    const range = parseDateRange(input.startDate, input.endDate, { maxRangeDays: 365 });
    const items = await monitoringRepository.findMany(input.metricType, range.startDate, range.endDate);

    return items.map((item) => ({
      date: toIsoDate(item.recordedAt),
      value: item.value,
      name: item.name
    }));
  },

  /**
   * Queue depth from two sources, deliberately reported side by side.
   *
   * `jobs` counts ExportJob rows by status. That was the only source, and it is
   * a proxy: it cannot see a job sitting in Redis with no consumer, cannot see
   * delayed or retrying jobs, and survives a Redis flush that emptied the real
   * queue.
   *
   * `queue` is BullMQ's own count. Showing both is the point — a divergence
   * between them *is* the signal that something is wrong, and collapsing them
   * into one number would throw that signal away.
   */
  async getQueueDepth() {
    const [jobs, queue] = await Promise.all([
      monitoringRepository.getQueueDepth(),
      getQueueCounts()
    ]);

    return {
      // Kept at the top level so existing callers reading `.total` still work.
      ...jobs,
      jobs,
      queue,
      redisAvailable: queue !== null
    };
  },

  async getRecentJobFailures(input: { startDate: string; endDate: string }) {
    const range = parseDateRange(input.startDate, input.endDate, { maxRangeDays: 365 });
    return monitoringRepository.getRecentJobFailures(range.startDate, range.endDate);
  }
};
