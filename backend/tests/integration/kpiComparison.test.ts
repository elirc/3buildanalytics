import request from "supertest";

import { createApp } from "../../src/app.js";
import { authHeaderFor } from "../helpers/auth.js";
import { disconnectDatabase, resetDatabase } from "../helpers/db.js";
import { createTrackedEvents, createUser } from "../helpers/factories.js";

const app = createApp();

/** 10 days; the period immediately before it is 2026-01-06 → 2026-01-15. */
const RANGE = { startDate: "2026-01-16", endDate: "2026-01-25" };
const CURRENT = new Date("2026-01-20T12:00:00.000Z");
const PREVIOUS = new Date("2026-01-10T12:00:00.000Z");

let admin: Awaited<ReturnType<typeof createUser>>;

beforeEach(async () => {
  await resetDatabase();
  admin = await createUser({ role: "SYSTEM_ADMIN" });
});

afterAll(async () => {
  await resetDatabase();
  await disconnectDatabase();
});

describe("previous-period comparison", () => {
  it("keeps the flat shape when compare is not requested", async () => {
    await createTrackedEvents({ count: 5, occurredAt: CURRENT });

    const response = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query(RANGE)
      .set(authHeaderFor(admin));

    // Existing callers must not have to change.
    expect(response.body.totalEvents).toBe(5);
  });

  it("returns value, previous and changePercent when requested", async () => {
    await createTrackedEvents({ count: 15, occurredAt: CURRENT });
    await createTrackedEvents({ count: 10, occurredAt: PREVIOUS });

    const response = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query({ ...RANGE, compare: "previous_period" })
      .set(authHeaderFor(admin));

    expect(response.status).toBe(200);
    expect(response.body.totalEvents).toEqual({
      value: 15,
      previous: 10,
      changePercent: 50
    });
  });

  it("computes the previous window as the same length immediately before", async () => {
    const response = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query({ ...RANGE, compare: "previous_period" })
      .set(authHeaderFor(admin));

    expect(response.body._meta.previousPeriod).toEqual({
      startDate: "2026-01-06",
      endDate: "2026-01-15"
    });
  });

  /**
   * An overlapping "previous" would double-count the boundary and make every
   * delta slightly wrong in a way nobody would notice.
   */
  it("does not overlap the current window", async () => {
    // Sits in the current window's first moments; must not count as previous.
    await createTrackedEvents({ count: 3, occurredAt: new Date("2026-01-16T00:00:01.000Z") });

    const response = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query({ ...RANGE, compare: "previous_period" })
      .set(authHeaderFor(admin));

    expect(response.body.totalEvents.value).toBe(3);
    expect(response.body.totalEvents.previous).toBe(0);
  });

  /** Growth from zero is undefined, not Infinity. */
  it("returns null rather than Infinity when the previous period was empty", async () => {
    await createTrackedEvents({ count: 4, occurredAt: CURRENT });

    const response = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query({ ...RANGE, compare: "previous_period" })
      .set(authHeaderFor(admin));

    expect(response.body.totalEvents.previous).toBe(0);
    expect(response.body.totalEvents.changePercent).toBeNull();
  });

  it("reports a decrease as a negative percentage", async () => {
    await createTrackedEvents({ count: 5, occurredAt: CURRENT });
    await createTrackedEvents({ count: 10, occurredAt: PREVIOUS });

    const response = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query({ ...RANGE, compare: "previous_period" })
      .set(authHeaderFor(admin));

    expect(response.body.totalEvents.changePercent).toBe(-50);
  });

  /**
   * The leak this test exists to prevent: filtering only the current values
   * would expose a hidden metric through its own `previous` field.
   */
  it("applies role visibility to both halves", async () => {
    const readOnly = await createUser({ role: "READ_ONLY" });
    await createTrackedEvents({ count: 5, occurredAt: CURRENT });

    const response = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query({ ...RANGE, compare: "previous_period" })
      .set(authHeaderFor(readOnly));

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("totalEvents");
    // READ_ONLY cannot see these at all — not their value, not their previous.
    expect(response.body).not.toHaveProperty("averageApiLatencyMs");
    expect(response.body).not.toHaveProperty("backgroundJobFailures");
    expect(response.body).not.toHaveProperty("adminActions");
  });

  it("caches comparison and flat responses separately", async () => {
    await createTrackedEvents({ count: 6, occurredAt: CURRENT });

    const flat = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query(RANGE)
      .set(authHeaderFor(admin));
    const compared = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query({ ...RANGE, compare: "previous_period" })
      .set(authHeaderFor(admin));

    // Sharing a cache key would serve one shape to a caller asking for the other.
    expect(typeof flat.body.totalEvents).toBe("number");
    expect(typeof compared.body.totalEvents).toBe("object");
  });

  it("rejects an unknown compare value", async () => {
    const response = await request(app)
      .get("/api/dashboard/kpi-summary")
      .query({ ...RANGE, compare: "last_year" })
      .set(authHeaderFor(admin));

    expect(response.status).toBe(400);
  });
});
