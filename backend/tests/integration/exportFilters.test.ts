import request from "supertest";

import { createApp } from "../../src/app.js";
import { prisma } from "../../src/db/prisma.js";
import { authHeaderFor } from "../helpers/auth.js";
import { disconnectDatabase, resetDatabase } from "../helpers/db.js";
import { createAuditEvent, createTrackedEvents, createUser } from "../helpers/factories.js";

const app = createApp();

const WINDOW = { startDate: "2026-01-01", endDate: "2026-01-31" };
const IN_RANGE = new Date("2026-01-15T12:00:00.000Z");
const OUT_OF_RANGE = new Date("2026-03-15T12:00:00.000Z");

let user: Awaited<ReturnType<typeof createUser>>;

beforeEach(async () => {
  await resetDatabase();
  user = await createUser({ role: "OPS_MANAGER" });
});

afterAll(async () => {
  await resetDatabase();
  await disconnectDatabase();
});

describe("export filter validation", () => {
  it("refuses a missing startDate and creates no job row", async () => {
    const response = await request(app)
      .post("/api/exports")
      .set(authHeaderFor(user))
      .send({ exportType: "TRACKED_EVENTS", filters: { endDate: "2026-01-31" } });

    expect(response.status).toBe(400);
    // The old flow inserted the row first, so every rejected request left an
    // orphaned PENDING job behind.
    expect(await prisma.exportJob.count()).toBe(0);
  });

  it("refuses an unknown filter key rather than ignoring it", async () => {
    const response = await request(app)
      .post("/api/exports")
      .set(authHeaderFor(user))
      .send({ exportType: "TRACKED_EVENTS", filters: { ...WINDOW, nonsense: "x" } });

    expect(response.status).toBe(400);
  });

  it("refuses a filter that belongs to a different export type", async () => {
    const response = await request(app)
      .post("/api/exports")
      .set(authHeaderFor(user))
      .send({ exportType: "AUDIT_EVENTS", filters: { ...WINDOW, eventType: "API_ERROR" } });

    expect(response.status).toBe(400);
  });

  it("refuses an inverted range", async () => {
    const response = await request(app)
      .post("/api/exports")
      .set(authHeaderFor(user))
      .send({
        exportType: "TRACKED_EVENTS",
        filters: { startDate: "2026-01-31", endDate: "2026-01-01" }
      });

    expect(response.status).toBe(400);
  });
});

describe("export filters are actually applied", () => {
  it("exports only the matching event type", async () => {
    await createTrackedEvents({ count: 4, eventType: "API_ERROR", occurredAt: IN_RANGE });
    await createTrackedEvents({ count: 6, eventType: "FEATURE_USED", occurredAt: IN_RANGE });

    const response = await request(app)
      .post("/api/exports")
      .set(authHeaderFor(user))
      .send({
        exportType: "TRACKED_EVENTS",
        filters: { ...WINDOW, eventType: "API_ERROR" }
      });

    expect(response.status).toBe(201);
    // Previously eventType was accepted and ignored, so this returned 10.
    expect(response.body.rowCount).toBe(4);
  });

  it("respects the date window", async () => {
    await createTrackedEvents({ count: 3, occurredAt: IN_RANGE });
    await createTrackedEvents({ count: 5, occurredAt: OUT_OF_RANGE });

    const response = await request(app)
      .post("/api/exports")
      .set(authHeaderFor(user))
      .send({ exportType: "TRACKED_EVENTS", filters: WINDOW });

    expect(response.body.rowCount).toBe(3);
  });

  it("filters audit exports by action", async () => {
    const auditor = await createUser({ role: "AUDIT_VIEWER" });
    await createAuditEvent({ action: "USER_CREATED", createdAt: IN_RANGE });
    await createAuditEvent({ action: "EXPORT_REQUESTED", createdAt: IN_RANGE });

    const response = await request(app)
      .post("/api/exports")
      .set(authHeaderFor(auditor))
      .send({
        exportType: "AUDIT_EVENTS",
        filters: { ...WINDOW, action: "USER_CREATED" }
      });

    expect(response.status).toBe(201);
    expect(response.body.rowCount).toBe(1);
  });
});

describe("export estimate", () => {
  it("counts without creating a job", async () => {
    await createTrackedEvents({ count: 7, occurredAt: IN_RANGE });

    const response = await request(app)
      .post("/api/exports/estimate")
      .set(authHeaderFor(user))
      .send({ exportType: "TRACKED_EVENTS", filters: WINDOW });

    expect(response.status).toBe(200);
    expect(response.body.rowCount).toBe(7);
    expect(response.body.willQueue).toBe(false);
    expect(await prisma.exportJob.count()).toBe(0);
  });

  it("matches what the export actually produces", async () => {
    await createTrackedEvents({ count: 5, eventType: "API_ERROR", occurredAt: IN_RANGE });
    await createTrackedEvents({ count: 9, eventType: "FEATURE_USED", occurredAt: IN_RANGE });

    const filters = { ...WINDOW, eventType: "API_ERROR" };

    const estimate = await request(app)
      .post("/api/exports/estimate")
      .set(authHeaderFor(user))
      .send({ exportType: "TRACKED_EVENTS", filters });
    const created = await request(app)
      .post("/api/exports")
      .set(authHeaderFor(user))
      .send({ exportType: "TRACKED_EVENTS", filters });

    expect(estimate.body.rowCount).toBe(created.body.rowCount);
  });
});
