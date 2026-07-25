import { MonitoringMetricType } from "@prisma/client";

import { prisma } from "../../src/db/prisma.js";
import { pruneOldMetrics } from "../../src/jobs/metricsRetention.processor.js";
import { metricsCollector } from "../../src/shared/metrics/collector.js";
import { disconnectDatabase, resetDatabase } from "../helpers/db.js";
import { createMonitoringMetric } from "../helpers/factories.js";

/**
 * METRICS_ENABLED is false throughout the suite (vitest.setup.ts), because the
 * collector writes to the same table several other suites assert on. These
 * tests enable it deliberately and turn it off again afterwards, so they
 * exercise the real code path without leaking rows into anyone else's fixtures.
 */
function withMetricsEnabled<T>(run: () => Promise<T>) {
  // Uses the collector's own setter, not process.env: config/env.ts parses
  // once at import, so assigning to process.env after that changes nothing.
  metricsCollector.setEnabled(true);
  return run().finally(() => {
    metricsCollector.setEnabled(false);
  });
}

beforeEach(async () => {
  await resetDatabase();
  metricsCollector.reset();
});

afterAll(async () => {
  metricsCollector.reset();
  await resetDatabase();
  await disconnectDatabase();
});

describe("metrics collector", () => {
  it("does nothing at all when disabled", async () => {
    // Guard against instrumentation that ignores its own kill switch.
    metricsCollector.recordRequest({
      route: "/api/events",
      method: "GET",
      statusCode: 200,
      durationMs: 12
    });

    expect(metricsCollector.bufferedCount()).toBe(0);

    await metricsCollector.flush();
    expect(await prisma.monitoringMetric.count()).toBe(0);
  });

  it("buffers requests rather than writing one row each", async () => {
    await withMetricsEnabled(async () => {
      for (let index = 0; index < 5; index += 1) {
        metricsCollector.recordRequest({
          route: "/api/events",
          method: "GET",
          statusCode: 200,
          durationMs: 10 + index
        });
      }

      // Still nothing written — batching is the point.
      expect(await prisma.monitoringMetric.count()).toBe(0);
      expect(metricsCollector.bufferedCount()).toBe(5);

      await metricsCollector.flush();

      const latency = await prisma.monitoringMetric.count({
        where: { metricType: MonitoringMetricType.API_LATENCY }
      });
      expect(latency).toBe(5);
    });
  });

  it("names metrics by route pattern, not by URL", async () => {
    await withMetricsEnabled(async () => {
      metricsCollector.recordRequest({
        route: "/api/events/:id",
        method: "GET",
        statusCode: 200,
        durationMs: 5
      });
      await metricsCollector.flush();

      const row = await prisma.monitoringMetric.findFirstOrThrow({
        where: { metricType: MonitoringMetricType.API_LATENCY }
      });

      // A per-id name would make this table a slow copy of the access log.
      expect(row.name).toBe("GET /api/events/:id");
    });
  });

  it("derives error rate over the flush window", async () => {
    await withMetricsEnabled(async () => {
      for (let index = 0; index < 3; index += 1) {
        metricsCollector.recordRequest({
          route: "/api/events",
          method: "GET",
          statusCode: 200,
          durationMs: 5
        });
      }
      metricsCollector.recordRequest({
        route: "/api/events",
        method: "GET",
        statusCode: 500,
        durationMs: 5
      });

      await metricsCollector.flush();

      const errorRate = await prisma.monitoringMetric.findFirstOrThrow({
        where: { metricType: MonitoringMetricType.ERROR_RATE }
      });

      // One failure in four requests.
      expect(errorRate.value).toBeCloseTo(0.25, 5);
    });
  });

  it("treats 4xx as a client problem, not a server error", async () => {
    await withMetricsEnabled(async () => {
      metricsCollector.recordRequest({
        route: "/api/events",
        method: "GET",
        statusCode: 404,
        durationMs: 5
      });
      await metricsCollector.flush();

      const errorRate = await prisma.monitoringMetric.findFirstOrThrow({
        where: { metricType: MonitoringMetricType.ERROR_RATE }
      });
      expect(errorRate.value).toBe(0);
    });
  });

  it("averages database query time over the window", async () => {
    await withMetricsEnabled(async () => {
      metricsCollector.recordDbQuery(10);
      metricsCollector.recordDbQuery(20);
      await metricsCollector.flush();

      const dbTime = await prisma.monitoringMetric.findFirstOrThrow({
        where: { metricType: MonitoringMetricType.DB_QUERY_TIME }
      });
      expect(dbTime.value).toBeCloseTo(15, 5);
    });
  });

  it("writes nothing when there is nothing to write", async () => {
    await withMetricsEnabled(async () => {
      const result = await metricsCollector.flush();
      expect(result.written).toBe(0);
    });
  });

  it("clears the buffer after flushing so rows are not written twice", async () => {
    await withMetricsEnabled(async () => {
      metricsCollector.recordRequest({
        route: "/api/events",
        method: "GET",
        statusCode: 200,
        durationMs: 5
      });

      await metricsCollector.flush();
      await metricsCollector.flush();

      const latency = await prisma.monitoringMetric.count({
        where: { metricType: MonitoringMetricType.API_LATENCY }
      });
      expect(latency).toBe(1);
    });
  });
});

describe("metrics retention", () => {
  it("deletes metrics past the retention window and keeps recent ones", async () => {
    await createMonitoringMetric({
      recordedAt: new Date(Date.now() - 400 * 86_400_000)
    });
    await createMonitoringMetric({ recordedAt: new Date() });

    const result = await pruneOldMetrics();

    expect(result.deleted).toBe(1);
    expect(await prisma.monitoringMetric.count()).toBe(1);
  });

  it("is safe to run when there is nothing to delete", async () => {
    await createMonitoringMetric({ recordedAt: new Date() });

    const result = await pruneOldMetrics();

    expect(result.deleted).toBe(0);
    expect(await prisma.monitoringMetric.count()).toBe(1);
  });
});
