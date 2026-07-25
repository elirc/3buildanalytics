import request from "supertest";

import { createApp } from "../../src/app.js";
import { authHeaderFor } from "../helpers/auth.js";
import { disconnectDatabase, resetDatabase } from "../helpers/db.js";
import { createTrackedEvent, createTrackedEvents, createUser } from "../helpers/factories.js";

const app = createApp();

/** A fixed range well clear of "today" so these tests do not depend on the clock. */
const RANGE = { startDate: "2026-01-01", endDate: "2026-01-31" };
const IN_RANGE = new Date("2026-01-15T12:00:00.000Z");
const OUT_OF_RANGE = new Date("2026-02-15T12:00:00.000Z");

let actor: Awaited<ReturnType<typeof createUser>>;

beforeEach(async () => {
  await resetDatabase();
  actor = await createUser({ role: "OPS_MANAGER" });
});

afterAll(async () => {
  await resetDatabase();
  await disconnectDatabase();
});

describe("events", () => {
  it("records a tracked event and returns it in the list", async () => {
    const created = await request(app)
      .post("/api/events/track")
      .set(authHeaderFor(actor))
      .send({
        eventType: "FEATURE_USED",
        entityType: "Dashboard",
        entityId: "dash-1",
        occurredAt: IN_RANGE.toISOString(),
        metadata: { feature: "analytics" }
      });

    expect(created.status).toBe(201);
    expect(created.body.id).toBeTruthy();

    const list = await request(app).get("/api/events").query(RANGE).set(authHeaderFor(actor));

    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].entityId).toBe("dash-1");
  });

  it("rejects an unknown event type with 400", async () => {
    const response = await request(app)
      .post("/api/events/track")
      .set(authHeaderFor(actor))
      .send({ eventType: "NOT_A_REAL_EVENT" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });

  it("filters by date range", async () => {
    await createTrackedEvent({ occurredAt: IN_RANGE });
    await createTrackedEvent({ occurredAt: OUT_OF_RANGE });

    const response = await request(app).get("/api/events").query(RANGE).set(authHeaderFor(actor));

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
  });

  it("filters by event type", async () => {
    await createTrackedEvent({ eventType: "API_ERROR", occurredAt: IN_RANGE });
    await createTrackedEvent({ eventType: "FEATURE_USED", occurredAt: IN_RANGE });

    const response = await request(app)
      .get("/api/events")
      .query({ ...RANGE, eventType: "API_ERROR" })
      .set(authHeaderFor(actor));

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.items[0].eventType).toBe("API_ERROR");
  });

  it("paginates with a default page size of 25 and clamps oversized pages", async () => {
    await createTrackedEvents({ count: 30, occurredAt: IN_RANGE });

    const firstPage = await request(app).get("/api/events").query(RANGE).set(authHeaderFor(actor));
    expect(firstPage.body.items).toHaveLength(25);
    expect(firstPage.body.total).toBe(30);
    expect(firstPage.body.pageSize).toBe(25);

    const secondPage = await request(app)
      .get("/api/events")
      .query({ ...RANGE, page: 2 })
      .set(authHeaderFor(actor));
    expect(secondPage.body.items).toHaveLength(5);

    // getPagination clamps pageSize to 100 regardless of what the caller asks for.
    const huge = await request(app)
      .get("/api/events")
      .query({ ...RANGE, pageSize: 5000 })
      .set(authHeaderFor(actor));
    expect(huge.body.pageSize).toBe(100);
  });

  it("returns 404 for an unknown event id", async () => {
    const response = await request(app)
      .get("/api/events/00000000-0000-0000-0000-000000000000")
      .set(authHeaderFor(actor));

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("rejects an inverted date range with 400", async () => {
    const response = await request(app)
      .get("/api/events")
      .query({ startDate: "2026-01-31", endDate: "2026-01-01" })
      .set(authHeaderFor(actor));

    expect(response.status).toBe(400);
  });

  it("rejects a range beyond the 180-day raw-query cap with 400", async () => {
    const response = await request(app)
      .get("/api/events")
      .query({ startDate: "2025-01-01", endDate: "2026-01-01" })
      .set(authHeaderFor(actor));

    expect(response.status).toBe(400);
  });
});
