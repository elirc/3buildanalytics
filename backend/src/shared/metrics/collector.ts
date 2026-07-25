import { MonitoringMetricType } from "@prisma/client";

import { cacheService } from "../../cache/cache.service.js";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { logWarn } from "../utils/logger.js";

/**
 * Batched metrics collection.
 *
 * MonitoringMetric rows were only ever written by the seed and a manual POST,
 * so every monitoring chart displayed synthetic data and kpiService's
 * averageApiLatencyMs was a seeded constant. The application never measured
 * itself.
 *
 * Samples are buffered in memory and flushed periodically rather than inserted
 * per request. A row per request would roughly double the write load of the API
 * to observe it â€” the classic way an observability feature becomes the
 * performance problem it was added to detect.
 *
 * The buffer is bounded. If flushing fails, samples are dropped rather than
 * accumulated: losing metrics is an acceptable failure, exhausting the heap
 * while trying to report on latency is not.
 */

const FLUSH_INTERVAL_MS = 30_000;
const FLUSH_AT_SAMPLES = 100;
const MAX_BUFFER = 5_000;

interface Sample {
  metricType: MonitoringMetricType;
  name: string;
  value: number;
  unit: string | null;
  recordedAt: Date;
}

let buffer: Sample[] = [];
let timer: NodeJS.Timeout | null = null;

/**
 * Whether collection is on.
 *
 * Seeded from env, but held separately and mutable. config/env.ts parses
 * process.env once at import, which is the right design for configuration —
 * and it means a test cannot flip the flag by assigning to process.env. Rather
 * than break that convention by reading process.env here, the collector owns a
 * flag with an explicit setter.
 */
let enabled = env.METRICS_ENABLED;

/** Request outcomes, aggregated per flush window rather than per request. */
const requestWindow = { total: 0, failed: 0 };
const dbWindow = { totalMs: 0, queries: 0 };

export const metricsCollector = {
  enabled() {
    return enabled;
  },

  /** Test seam. Production sets this once, from env, at import. */
  setEnabled(value: boolean) {
    enabled = value;
  },

  /**
   * Records one completed HTTP request.
   *
   * `route` must be the route *pattern* (/api/events/:id), never the raw URL.
   * Using the URL would create a distinct metric name per id and turn the
   * metrics table into a slow copy of the access log.
   */
  recordRequest(input: { route: string; method: string; statusCode: number; durationMs: number }) {
    if (!enabled) {
      return;
    }

    requestWindow.total += 1;
    if (input.statusCode >= 500) {
      requestWindow.failed += 1;
    }

    push({
      metricType: MonitoringMetricType.API_LATENCY,
      name: `${input.method} ${input.route}`,
      value: input.durationMs,
      unit: "ms",
      recordedAt: new Date()
    });
  },

  recordDbQuery(durationMs: number) {
    if (!enabled) {
      return;
    }

    dbWindow.totalMs += durationMs;
    dbWindow.queries += 1;
  },

  recordJobOutcome(input: { queue: string; failed: boolean }) {
    if (!enabled) {
      return;
    }

    push({
      metricType: MonitoringMetricType.JOB_FAILURE_RATE,
      name: input.queue,
      value: input.failed ? 1 : 0,
      unit: "ratio",
      recordedAt: new Date()
    });
  },

  /** Writes the buffer and the derived window metrics. */
  async flush() {
    const samples = buffer;
    buffer = [];

    const derived = drainWindows();
    const rows = [...samples, ...derived];

    if (rows.length === 0) {
      return { written: 0 };
    }

    try {
      await prisma.monitoringMetric.createMany({ data: rows });
      return { written: rows.length };
    } catch (error) {
      // Deliberately not re-buffered: a failing database would otherwise grow
      // the buffer until the process dies.
      logWarn("metrics.flush.failed", {
        dropped: rows.length,
        error: error instanceof Error ? error.message : "unknown"
      });
      return { written: 0, dropped: rows.length };
    }
  },

  start() {
    if (timer || !enabled) {
      return;
    }

    timer = setInterval(() => {
      void metricsCollector.flush();
    }, FLUSH_INTERVAL_MS);

    // Never hold the process open for a metrics timer.
    timer.unref();
  },

  async stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    await metricsCollector.flush();
  },

  /** Test seam. */
  reset() {
    buffer = [];
    requestWindow.total = 0;
    requestWindow.failed = 0;
    dbWindow.totalMs = 0;
    dbWindow.queries = 0;
  },

  bufferedCount() {
    return buffer.length;
  }
};

function push(sample: Sample) {
  if (buffer.length >= MAX_BUFFER) {
    return;
  }

  buffer.push(sample);

  if (buffer.length >= FLUSH_AT_SAMPLES) {
    void metricsCollector.flush();
  }
}

/**
 * Turns per-window counters into rate metrics.
 *
 * Error rate and cache hit rate are ratios over a window, not per-event
 * observations, so they are computed at flush time rather than pushed.
 */
function drainWindows(): Sample[] {
  const now = new Date();
  const rows: Sample[] = [];

  if (requestWindow.total > 0) {
    rows.push({
      metricType: MonitoringMetricType.ERROR_RATE,
      name: "api",
      value: requestWindow.failed / requestWindow.total,
      unit: "ratio",
      recordedAt: now
    });
    requestWindow.total = 0;
    requestWindow.failed = 0;
  }

  if (dbWindow.queries > 0) {
    rows.push({
      metricType: MonitoringMetricType.DB_QUERY_TIME,
      name: "prisma",
      value: dbWindow.totalMs / dbWindow.queries,
      unit: "ms",
      recordedAt: now
    });
    dbWindow.totalMs = 0;
    dbWindow.queries = 0;
  }

  const cache = cacheService.drainCounters();
  const cacheTotal = cache.hits + cache.misses;
  if (cacheTotal > 0) {
    rows.push({
      metricType: MonitoringMetricType.CACHE_HIT_RATE,
      name: "dashboard",
      value: cache.hits / cacheTotal,
      unit: "ratio",
      recordedAt: now
    });
  }

  return rows;
}
