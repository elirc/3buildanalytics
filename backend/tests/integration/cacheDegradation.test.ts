import request from "supertest";

import { createApp } from "../../src/app.js";
import { cacheService } from "../../src/cache/cache.service.js";
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
 * server.ts catches a failed Redis connection at boot and serves anyway, so
 * "Redis is down" is a supported operating mode, not an outage. These tests pin
 * that promise: cached endpoints must fall back to the database quickly rather
 * than hanging on an unreachable cache.
 *
 * They pass whether or not Redis is actually running, which is the point — the
 * suite must not require it.
 */
describe("cache degradation", () => {
  it("serves KPI summaries within a request timeout even if the cache is unavailable", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN" });
    await createTrackedEvents({ count: 5, occurredAt: IN_RANGE });

    const startedAt = Date.now();
    const response = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query(RANGE)
      .set(authHeaderFor(admin));
    const elapsed = Date.now() - startedAt;

    expect(response.status).toBe(200);
    expect(response.body.totalEvents).toBe(5);

    // Generous, but far below the point where a user or load balancer gives up.
    // Before the redis.ts fix this took 30s+ (the test timeout) with Redis down,
    // because ioredis queued the GET forever instead of failing it.
    expect(elapsed).toBeLessThan(10_000);
  });

  it("returns null from cacheService.get rather than throwing or hanging", async () => {
    const startedAt = Date.now();
    const value = await cacheService.get("test:does-not-exist");
    const elapsed = Date.now() - startedAt;

    expect(value).toBeNull();
    expect(elapsed).toBeLessThan(5_000);
  });

  it("does not throw when a cache write cannot be delivered", async () => {
    await expect(cacheService.set("test:key", { ok: true }, 10)).resolves.not.toThrow();
  });
});
