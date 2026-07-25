import request from "supertest";

import { createApp } from "../../src/app.js";
import { authHeaderFor } from "../helpers/auth.js";
import { disconnectDatabase, resetDatabase } from "../helpers/db.js";
import { createAuditEvent, createTrackedEvents, createUser } from "../helpers/factories.js";

const app = createApp();

const RANGE = { startDate: "2026-01-01", endDate: "2026-01-31" };
const DAY_ONE = new Date("2026-01-05T09:00:00.000Z");
const DAY_TWO = new Date("2026-01-06T09:00:00.000Z");

let admin: Awaited<ReturnType<typeof createUser>>;

/**
 * Response-shape contracts for the summary endpoints.
 *
 * Written before the SQL refactor and asserting the *existing* output, so they
 * are a safety net rather than a description of whatever the new code happens
 * to do. A refactor is only a refactor if you can prove the behaviour did not
 * change.
 */
beforeEach(async () => {
  await resetDatabase();
  admin = await createUser({ role: "SYSTEM_ADMIN" });
});

afterAll(async () => {
  await resetDatabase();
  await disconnectDatabase();
});

describe("events summary by type", () => {
  it("counts each event type in range", async () => {
    await createTrackedEvents({ count: 4, eventType: "API_ERROR", occurredAt: DAY_ONE });
    await createTrackedEvents({ count: 6, eventType: "FEATURE_USED", occurredAt: DAY_TWO });
    // Outside the range — must not appear.
    await createTrackedEvents({ count: 9, eventType: "API_ERROR", occurredAt: new Date("2026-03-01T00:00:00Z") });

    const response = await request(app)
      .get("/api/events/summary/by-type")
      .query(RANGE)
      .set(authHeaderFor(admin));

    expect(response.status).toBe(200);

    const byType = Object.fromEntries(
      response.body.map((row: { eventType: string; count: number }) => [row.eventType, row.count])
    );

    expect(byType.API_ERROR).toBe(4);
    expect(byType.FEATURE_USED).toBe(6);
  });

  it("returns an entry for every event type, including zeroes", async () => {
    await createTrackedEvents({ count: 1, eventType: "API_ERROR", occurredAt: DAY_ONE });

    const response = await request(app)
      .get("/api/events/summary/by-type")
      .query(RANGE)
      .set(authHeaderFor(admin));

    // The existing contract: all 11 enum values, zeroes included, so a chart
    // shows the full vocabulary rather than only what happened to occur.
    expect(response.body).toHaveLength(11);
    const zero = response.body.find((row: { eventType: string }) => row.eventType === "USER_SIGNED_UP");
    expect(zero.count).toBe(0);
  });

  it("returns zeroes for every type when nothing happened", async () => {
    const response = await request(app)
      .get("/api/events/summary/by-type")
      .query(RANGE)
      .set(authHeaderFor(admin));

    expect(response.body).toHaveLength(11);
    expect(response.body.every((row: { count: number }) => row.count === 0)).toBe(true);
  });
});

describe("events summary over time", () => {
  it("buckets by day and sorts ascending", async () => {
    await createTrackedEvents({ count: 3, occurredAt: DAY_ONE });
    await createTrackedEvents({ count: 2, occurredAt: DAY_TWO });

    const response = await request(app)
      .get("/api/events/summary/over-time")
      .query(RANGE)
      .set(authHeaderFor(admin));

    expect(response.body).toEqual([
      { date: "2026-01-05", count: 3 },
      { date: "2026-01-06", count: 2 }
    ]);
  });

  it("omits days with no events", async () => {
    await createTrackedEvents({ count: 1, occurredAt: DAY_ONE });

    const response = await request(app)
      .get("/api/events/summary/over-time")
      .query(RANGE)
      .set(authHeaderFor(admin));

    expect(response.body).toHaveLength(1);
  });
});

describe("audit summaries", () => {
  it("groups by action, sorted by name", async () => {
    await createAuditEvent({ action: "USER_CREATED", createdAt: DAY_ONE });
    await createAuditEvent({ action: "USER_CREATED", createdAt: DAY_TWO });
    await createAuditEvent({ action: "EXPORT_REQUESTED", createdAt: DAY_ONE });

    const response = await request(app)
      .get("/api/audit-events/summary/by-action")
      .query(RANGE)
      .set(authHeaderFor(admin));

    expect(response.body).toEqual([
      { action: "EXPORT_REQUESTED", count: 1 },
      { action: "USER_CREATED", count: 2 }
    ]);
  });

  it("groups by actor email", async () => {
    const alice = await createUser({ role: "OPS_MANAGER", email: "alice@example.com" });
    await createAuditEvent({ actorId: alice.id, createdAt: DAY_ONE });
    await createAuditEvent({ actorId: alice.id, createdAt: DAY_TWO });

    const response = await request(app)
      .get("/api/audit-events/summary/by-actor")
      .query(RANGE)
      .set(authHeaderFor(admin));

    const alices = response.body.find((row: { actor: string }) => row.actor === "alice@example.com");
    expect(alices.count).toBe(2);
  });

  it("labels actorless events as unknown", async () => {
    await createAuditEvent({ createdAt: DAY_ONE });

    const response = await request(app)
      .get("/api/audit-events/summary/by-actor")
      .query(RANGE)
      .set(authHeaderFor(admin));

    expect(response.body).toEqual([{ actor: "unknown", count: 1 }]);
  });

  it("buckets audit activity by day, ascending", async () => {
    await createAuditEvent({ createdAt: DAY_ONE });
    await createAuditEvent({ createdAt: DAY_TWO });
    await createAuditEvent({ createdAt: DAY_TWO });

    const response = await request(app)
      .get("/api/audit-events/summary/over-time")
      .query(RANGE)
      .set(authHeaderFor(admin));

    expect(response.body).toEqual([
      { date: "2026-01-05", count: 1 },
      { date: "2026-01-06", count: 2 }
    ]);
  });

  it("returns an empty array when nothing is in range", async () => {
    const response = await request(app)
      .get("/api/audit-events/summary/by-action")
      .query(RANGE)
      .set(authHeaderFor(admin));

    expect(response.body).toEqual([]);
  });
});
