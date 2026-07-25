import request from "supertest";

import { createApp } from "../../src/app.js";
import { authHeaderFor } from "../helpers/auth.js";
import { disconnectDatabase, resetDatabase } from "../helpers/db.js";
import { createTrackedEvents, createUser } from "../helpers/factories.js";

const app = createApp();

const RANGE = { startDate: "2026-01-01", endDate: "2026-01-31" };
const IN_RANGE = new Date("2026-01-15T12:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await resetDatabase();
  await disconnectDatabase();
});

describe("dashboard KPI summary", () => {
  it("counts events in range and computes the error rate", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN" });
    await createTrackedEvents({ count: 8, eventType: "FEATURE_USED", occurredAt: IN_RANGE });
    await createTrackedEvents({ count: 2, eventType: "API_ERROR", occurredAt: IN_RANGE });

    const response = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query(RANGE)
      .set(authHeaderFor(admin));

    expect(response.status).toBe(200);
    expect(response.body.totalEvents).toBe(10);
    expect(response.body.failedEvents).toBe(2);
    expect(response.body.errorRate).toBeCloseTo(0.2, 5);
  });

  /**
   * Field-level visibility is the third authorization layer and the one most
   * easily forgotten. These expectations encode the matrix in
   * shared/permissions.ts:applyMetricVisibility.
   */
  it.each([
    ["SYSTEM_ADMIN", ["averageApiLatencyMs", "backgroundJobFailures", "adminActions"], []],
    ["EXECUTIVE_VIEWER", ["averageApiLatencyMs"], ["adminActions"]],
    ["READ_ONLY", [], ["averageApiLatencyMs", "backgroundJobFailures", "adminActions"]],
    ["PRODUCT_MANAGER", ["averageApiLatencyMs", "adminActions"], ["backgroundJobFailures"]],
    ["AUDIT_VIEWER", ["adminActions"], ["averageApiLatencyMs"]]
  ] as const)("hides role-restricted metrics for %s", async (role, visible, hidden) => {
    const user = await createUser({ role });

    const response = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query(RANGE)
      .set(authHeaderFor(user));

    expect(response.status).toBe(200);
    // Always visible to anyone who can see a dashboard at all.
    expect(response.body).toHaveProperty("totalEvents");
    expect(response.body).toHaveProperty("errorRate");

    for (const key of visible) {
      expect(response.body).toHaveProperty(key);
    }
    for (const key of hidden) {
      expect(response.body).not.toHaveProperty(key);
    }
  });

  /**
   * US-02's headline acceptance criterion, asserted end to end rather than in a
   * unit test: an event recorded *right now* must appear in a range that ends
   * today. It used not to, because endDate resolved to midnight UTC and so
   * excluded the whole current day.
   */
  it("includes an event recorded today in a range that ends today", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN" });
    const now = new Date();
    await createTrackedEvents({ count: 3, occurredAt: now });

    const today = now.toISOString().slice(0, 10);
    const response = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query({ startDate: today, endDate: today })
      .set(authHeaderFor(admin));

    expect(response.status).toBe(200);
    expect(response.body.totalEvents).toBe(3);
  });

  it("rejects an impossible calendar date rather than silently rolling it over", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN" });

    const response = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query({ startDate: "2026-02-31", endDate: "2026-03-05" })
      .set(authHeaderFor(admin));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });

  it("requires both startDate and endDate", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN" });

    const response = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query({ startDate: "2026-01-01" })
      .set(authHeaderFor(admin));

    expect(response.status).toBe(400);
  });

  it("allows a 365-day range on dashboards even though raw queries cap at 180", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN" });

    const response = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query({ startDate: "2025-06-01", endDate: "2026-05-01" })
      .set(authHeaderFor(admin));

    expect(response.status).toBe(200);
  });
});

describe("dashboard chart endpoints", () => {
  it("buckets events over time by day", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN" });
    await createTrackedEvents({ count: 3, occurredAt: new Date("2026-01-10T09:00:00.000Z") });
    await createTrackedEvents({ count: 2, occurredAt: new Date("2026-01-11T09:00:00.000Z") });

    const response = await request(app)
      .get("/api/dashboard/events-over-time")
      .query(RANGE)
      .set(authHeaderFor(admin));

    expect(response.status).toBe(200);
    const points: Array<{ date: string; count: number }> = response.body.data;
    expect(points.find((point) => point.date === "2026-01-10")?.count).toBe(3);
    expect(points.find((point) => point.date === "2026-01-11")?.count).toBe(2);
  });

  it("returns funnel stages in order", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN" });
    await createTrackedEvents({ count: 4, eventType: "USER_SIGNED_UP", occurredAt: IN_RANGE });
    await createTrackedEvents({ count: 2, eventType: "USER_LOGGED_IN", occurredAt: IN_RANGE });

    const response = await request(app)
      .get("/api/dashboard/conversion-funnel")
      .query(RANGE)
      .set(authHeaderFor(admin));

    expect(response.status).toBe(200);
    expect(response.body.map((stage: { stage: string }) => stage.stage)).toEqual([
      "Signed up",
      "Logged in",
      "Used feature",
      "Exported CSV"
    ]);
    expect(response.body[0].count).toBe(4);
    expect(response.body[1].conversionRate).toBeCloseTo(0.5, 5);
  });
});
