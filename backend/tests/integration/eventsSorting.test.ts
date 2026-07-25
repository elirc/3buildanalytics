import request from "supertest";

import { createApp } from "../../src/app.js";
import { authHeaderFor } from "../helpers/auth.js";
import { disconnectDatabase, resetDatabase } from "../helpers/db.js";
import { createTrackedEvent, createTrackedEvents, createUser } from "../helpers/factories.js";

const app = createApp();

const RANGE = { startDate: "2026-01-01", endDate: "2026-01-31" };
let actor: Awaited<ReturnType<typeof createUser>>;

beforeEach(async () => {
  await resetDatabase();
  actor = await createUser({ role: "OPS_MANAGER" });
});

afterAll(async () => {
  await resetDatabase();
  await disconnectDatabase();
});

describe("events sorting", () => {
  it("defaults to newest first", async () => {
    await createTrackedEvent({ occurredAt: new Date("2026-01-05T00:00:00Z"), entityId: "older" });
    await createTrackedEvent({ occurredAt: new Date("2026-01-20T00:00:00Z"), entityId: "newer" });

    const response = await request(app).get("/api/events").query(RANGE).set(authHeaderFor(actor));

    expect(response.status).toBe(200);
    expect(response.body.items[0].entityId).toBe("newer");
    expect(response.body.sortBy).toBe("occurredAt");
    expect(response.body.sortDir).toBe("desc");
  });

  it("reverses when sortDir=asc", async () => {
    await createTrackedEvent({ occurredAt: new Date("2026-01-05T00:00:00Z"), entityId: "older" });
    await createTrackedEvent({ occurredAt: new Date("2026-01-20T00:00:00Z"), entityId: "newer" });

    const response = await request(app)
      .get("/api/events")
      .query({ ...RANGE, sortDir: "asc" })
      .set(authHeaderFor(actor));

    expect(response.body.items[0].entityId).toBe("older");
  });

  /**
   * Worth knowing: eventType is a Postgres ENUM, and Postgres orders enums by
   * their *declaration* order, not alphabetically. In schema.prisma API_ERROR
   * is declared before ADMIN_ACTION, so ascending puts API_ERROR first.
   *
   * That is the behaviour we want — it sorts by the enum's own index and can
   * use the column's index, whereas alphabetical order would require casting to
   * text on every row. It just is not what "sort A-Z" intuitively suggests, so
   * it is pinned here rather than left to surprise someone later.
   */
  it("sorts by a non-default allowed column, using enum declaration order", async () => {
    await createTrackedEvent({ eventType: "API_ERROR", occurredAt: new Date("2026-01-05T00:00:00Z") });
    await createTrackedEvent({ eventType: "ADMIN_ACTION", occurredAt: new Date("2026-01-06T00:00:00Z") });

    const ascending = await request(app)
      .get("/api/events")
      .query({ ...RANGE, sortBy: "eventType", sortDir: "asc" })
      .set(authHeaderFor(actor));
    const descending = await request(app)
      .get("/api/events")
      .query({ ...RANGE, sortBy: "eventType", sortDir: "desc" })
      .set(authHeaderFor(actor));

    expect(ascending.body.items[0].eventType).toBe("API_ERROR");
    expect(descending.body.items[0].eventType).toBe("ADMIN_ACTION");
  });

  /**
   * Prisma will happily accept an arbitrary key in orderBy, so an unchecked
   * sortBy is a direct path from query string to query plan.
   */
  it.each(["password", "id; DROP TABLE users", "user.passwordHash", ""])(
    "rejects the disallowed sort column %j",
    async (sortBy) => {
      const response = await request(app)
        .get("/api/events")
        .query({ ...RANGE, sortBy })
        .set(authHeaderFor(actor));

      // An empty string means "no preference" and falls back to the default.
      if (sortBy === "") {
        expect(response.status).toBe(200);
      } else {
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe("BAD_REQUEST");
      }
    }
  );

  it("rejects an invalid sort direction", async () => {
    const response = await request(app)
      .get("/api/events")
      .query({ ...RANGE, sortDir: "sideways" })
      .set(authHeaderFor(actor));

    expect(response.status).toBe(400);
  });
});

describe("events pagination", () => {
  it("reports total and pageCount", async () => {
    await createTrackedEvents({ count: 30, occurredAt: new Date("2026-01-15T00:00:00Z") });

    const response = await request(app).get("/api/events").query(RANGE).set(authHeaderFor(actor));

    expect(response.body.total).toBe(30);
    expect(response.body.pageCount).toBe(2);
    expect(response.body.items).toHaveLength(25);
  });

  it("reports one page even when empty, so the UI never renders 'page 1 of 0'", async () => {
    const response = await request(app).get("/api/events").query(RANGE).set(authHeaderFor(actor));

    expect(response.body.total).toBe(0);
    expect(response.body.pageCount).toBe(1);
  });

  /**
   * Rows sharing a sort value can otherwise come back in a different order on
   * each query, so one row appears on two pages and another is never shown.
   */
  it("pages deterministically when many rows share a sort value", async () => {
    const sameInstant = new Date("2026-01-15T12:00:00Z");
    await createTrackedEvents({ count: 40, occurredAt: sameInstant });

    const first = await request(app)
      .get("/api/events")
      .query({ ...RANGE, pageSize: 20, page: 1 })
      .set(authHeaderFor(actor));
    const second = await request(app)
      .get("/api/events")
      .query({ ...RANGE, pageSize: 20, page: 2 })
      .set(authHeaderFor(actor));

    const firstIds = first.body.items.map((item: { id: string }) => item.id);
    const secondIds = second.body.items.map((item: { id: string }) => item.id);

    expect(new Set([...firstIds, ...secondIds]).size).toBe(40);
  });
});

describe("audit sorting", () => {
  it("supports the same contract", async () => {
    const admin = await createUser({ role: "AUDIT_VIEWER" });

    const response = await request(app)
      .get("/api/audit-events")
      .query({ ...RANGE, sortBy: "action", sortDir: "asc" })
      .set(authHeaderFor(admin));

    expect(response.status).toBe(200);
    expect(response.body.sortBy).toBe("action");
    expect(response.body.pageCount).toBe(1);
  });

  it("rejects a disallowed column", async () => {
    const admin = await createUser({ role: "AUDIT_VIEWER" });

    const response = await request(app)
      .get("/api/audit-events")
      .query({ ...RANGE, sortBy: "ipAddress" })
      .set(authHeaderFor(admin));

    expect(response.status).toBe(400);
  });
});
