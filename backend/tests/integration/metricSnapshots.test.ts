import request from "supertest";

import { createApp } from "../../src/app.js";
import { prisma } from "../../src/db/prisma.js";
import { metricSnapshotService } from "../../src/modules/dashboard/metricSnapshot.service.js";
import { authHeaderFor } from "../helpers/auth.js";
import { disconnectDatabase, resetDatabase } from "../helpers/db.js";
import { createTrackedEvents, createUser } from "../helpers/factories.js";

const app = createApp();

/** A 40-day window entirely in the past, so the snapshot path is eligible. */
const RANGE = { startDate: "2026-01-01", endDate: "2026-02-09" };
const DAY_ONE = new Date("2026-01-05T09:00:00.000Z");
const DAY_TWO = new Date("2026-01-06T09:00:00.000Z");

let admin: Awaited<ReturnType<typeof createUser>>;

beforeEach(async () => {
  await resetDatabase();
  admin = await createUser({ role: "SYSTEM_ADMIN" });
});

afterAll(async () => {
  await resetDatabase();
  await disconnectDatabase();
});

describe("daily rollup", () => {
  it("counts a day's events into snapshot rows", async () => {
    await createTrackedEvents({ count: 4, eventType: "FEATURE_USED", occurredAt: DAY_ONE });
    await createTrackedEvents({ count: 2, eventType: "API_ERROR", occurredAt: DAY_ONE });
    // A different day must not leak into the first day's totals.
    await createTrackedEvents({ count: 5, occurredAt: DAY_TWO });

    await metricSnapshotService.rollupDay(DAY_ONE);

    const rows = await prisma.metricSnapshot.findMany({ orderBy: { metricKey: "asc" } });
    const byKey = Object.fromEntries(rows.map((row) => [row.metricKey, row.value]));

    expect(byKey["events.total"]).toBe(6);
    expect(byKey["events.errors"]).toBe(2);
  });

  /** Job retries are normal, so a second run must overwrite, not double. */
  it("is idempotent", async () => {
    await createTrackedEvents({ count: 3, occurredAt: DAY_ONE });

    await metricSnapshotService.rollupDay(DAY_ONE);
    await metricSnapshotService.rollupDay(DAY_ONE);

    const rows = await prisma.metricSnapshot.findMany({ where: { metricKey: "events.total" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBe(3);
  });

  it("backfills a range of days", async () => {
    await createTrackedEvents({ count: 2, occurredAt: DAY_ONE });
    await createTrackedEvents({ count: 3, occurredAt: DAY_TWO });

    const result = await metricSnapshotService.backfill(DAY_ONE, DAY_TWO);

    expect(result.days).toBe(2);
    const totals = await prisma.metricSnapshot.findMany({ where: { metricKey: "events.total" } });
    expect(totals.map((row) => row.value).sort()).toEqual([2, 3]);
  });
});

describe("snapshot-backed KPI summary", () => {
  /**
   * The acceptance test that matters: both paths must produce the same
   * numbers. A faster answer that disagrees with the slow one is not an
   * optimisation, it is a bug with better latency.
   */
  it("agrees with the live query over the same range", async () => {
    await createTrackedEvents({ count: 7, eventType: "FEATURE_USED", occurredAt: DAY_ONE });
    await createTrackedEvents({ count: 3, eventType: "API_ERROR", occurredAt: DAY_TWO });
    await createTrackedEvents({ count: 2, eventType: "CSV_EXPORTED", occurredAt: DAY_TWO });

    // Live first — no snapshots exist yet.
    const live = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query(RANGE)
      .set(authHeaderFor(admin));

    expect(live.body._meta.source).toBe("live");

    await metricSnapshotService.backfill(
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-02-09T00:00:00.000Z")
    );

    const fromSnapshots = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query({ ...RANGE, refresh: "true" })
      .set(authHeaderFor(admin));

    expect(fromSnapshots.body._meta.source).toBe("snapshot");
    expect(fromSnapshots.body.totalEvents).toBe(live.body.totalEvents);
    expect(fromSnapshots.body.failedEvents).toBe(live.body.failedEvents);
    expect(fromSnapshots.body.csvExports).toBe(live.body.csvExports);
    expect(fromSnapshots.body.errorRate).toBeCloseTo(live.body.errorRate, 5);
  });

  it("falls back to live when the range is only partly covered", async () => {
    await createTrackedEvents({ count: 4, occurredAt: DAY_ONE });
    // One day only — nowhere near the whole 40-day window.
    await metricSnapshotService.rollupDay(DAY_ONE);

    const response = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query(RANGE)
      .set(authHeaderFor(admin));

    expect(response.body._meta.source).toBe("live");
    expect(response.body.totalEvents).toBe(4);
  });

  it("falls back to live for a short range even when snapshots exist", async () => {
    await createTrackedEvents({ count: 4, occurredAt: DAY_ONE });
    await metricSnapshotService.backfill(DAY_ONE, DAY_TWO);

    const response = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query({ startDate: "2026-01-05", endDate: "2026-01-06" })
      .set(authHeaderFor(admin));

    expect(response.body._meta.source).toBe("live");
  });

  /**
   * A range including today mixes complete snapshot days with an incomplete
   * current one; summing those would quietly under-report.
   */
  it("falls back to live when the range includes today", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - 40);

    const response = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query({ startDate: start.toISOString().slice(0, 10), endDate: today })
      .set(authHeaderFor(admin));

    expect(response.body._meta.source).toBe("live");
  });

  it("degrades to live when every snapshot is deleted", async () => {
    await createTrackedEvents({ count: 5, occurredAt: DAY_ONE });
    await metricSnapshotService.backfill(
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-02-09T00:00:00.000Z")
    );
    await prisma.metricSnapshot.deleteMany();

    const response = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query(RANGE)
      .set(authHeaderFor(admin));

    expect(response.status).toBe(200);
    expect(response.body._meta.source).toBe("live");
    expect(response.body.totalEvents).toBe(5);
  });
});
