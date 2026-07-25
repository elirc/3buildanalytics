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

/**
 * Is ?refresh=true actually restricted to admins?
 *
 * metricVisibilityMiddleware tried to enforce that by assigning to
 * request.query, and no test ever checked whether the assignment survived. This
 * suite answers the question rather than assuming either way.
 *
 * Note: with no Redis these tests still pass, because an uncached endpoint
 * recomputes every time and the header reports BYPASS/MISS honestly.
 */
describe("cache refresh authorisation", () => {
  it("ignores ?refresh=true from a non-admin", async () => {
    const readOnly = await createUser({ role: "READ_ONLY" });
    await createTrackedEvents({ count: 3, occurredAt: IN_RANGE });

    // Warm the cache.
    await request(app).get("/api/dashboard/kpi-summary").query(RANGE).set(authHeaderFor(readOnly));

    const response = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query({ ...RANGE, refresh: "true" })
      .set(authHeaderFor(readOnly));

    expect(response.status).toBe(200);
    // A non-admin must never be able to force recomputation.
    expect(response.headers["x-cache"]).not.toBe("BYPASS");
  });

  it("honours ?refresh=true from an admin", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN" });
    await createTrackedEvents({ count: 3, occurredAt: IN_RANGE });

    await request(app).get("/api/dashboard/kpi-summary").query(RANGE).set(authHeaderFor(admin));

    const response = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query({ ...RANGE, refresh: "true" })
      .set(authHeaderFor(admin));

    expect(response.status).toBe(200);
    expect(response.headers["x-cache"]).toBe("BYPASS");
  });

  it("reports cache status on every dashboard response", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN" });

    const response = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query(RANGE)
      .set(authHeaderFor(admin));

    expect(["HIT", "MISS", "BYPASS"]).toContain(response.headers["x-cache"]);
  });
});

describe("cache invalidation on write", () => {
  /**
   * Before this story the only way to see new data was to wait out the 300s
   * TTL. Recording an event and not seeing it is indistinguishable from the
   * event not being recorded.
   */
  it("shows a newly tracked event without waiting for the TTL", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN" });
    await createTrackedEvents({ count: 2, occurredAt: IN_RANGE });

    const first = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query(RANGE)
      .set(authHeaderFor(admin));
    expect(first.body.totalEvents).toBe(2);

    await request(app)
      .post("/api/events/track")
      .set(authHeaderFor(admin))
      .send({
        eventType: "FEATURE_USED",
        entityType: "Dashboard",
        occurredAt: IN_RANGE.toISOString()
      });

    const second = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query(RANGE)
      .set(authHeaderFor(admin));

    expect(second.body.totalEvents).toBe(3);
    expect(second.headers["x-cache"]).not.toBe("HIT");
  });
});
