import request from "supertest";

import { createApp } from "../../src/app.js";
import { prisma } from "../../src/db/prisma.js";
import { authHeaderFor } from "../helpers/auth.js";
import { disconnectDatabase, resetDatabase } from "../helpers/db.js";
import { createUser } from "../helpers/factories.js";

const app = createApp();

const VALID = {
  name: "Last week's errors",
  page: "events" as const,
  filtersJson: { startDate: "2026-01-01", endDate: "2026-01-07", eventType: "API_ERROR" }
};

let owner: Awaited<ReturnType<typeof createUser>>;
let other: Awaited<ReturnType<typeof createUser>>;

beforeEach(async () => {
  await resetDatabase();
  owner = await createUser({ role: "OPS_MANAGER" });
  other = await createUser({ role: "PRODUCT_MANAGER" });
});

afterAll(async () => {
  await resetDatabase();
  await disconnectDatabase();
});

describe("saved views", () => {
  it("round-trips a view's filters", async () => {
    const created = await request(app)
      .post("/api/saved-views")
      .set(authHeaderFor(owner))
      .send(VALID);

    expect(created.status).toBe(201);
    expect(created.body.filtersJson).toEqual(VALID.filtersJson);

    const listed = await request(app)
      .get("/api/saved-views?page=events")
      .set(authHeaderFor(owner));

    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].filtersJson).toEqual(VALID.filtersJson);
  });

  it("scopes views to their page", async () => {
    await request(app).post("/api/saved-views").set(authHeaderFor(owner)).send(VALID);

    const onOperations = await request(app)
      .get("/api/saved-views?page=operations")
      .set(authHeaderFor(owner));

    expect(onOperations.body).toHaveLength(0);
  });

  it("always records the caller as the owner, whatever the body says", async () => {
    const created = await request(app)
      .post("/api/saved-views")
      .set(authHeaderFor(owner))
      .send({ ...VALID, ownerId: other.id });

    expect(created.status).toBe(201);
    expect(created.body.ownerId).toBe(owner.id);
  });

  it("rejects unknown filter keys instead of storing them", async () => {
    const response = await request(app)
      .post("/api/saved-views")
      .set(authHeaderFor(owner))
      .send({ ...VALID, filtersJson: { ...VALID.filtersJson, evil: "payload" } });

    expect(response.status).toBe(400);
  });

  it("rejects an unknown page", async () => {
    const response = await request(app)
      .post("/api/saved-views")
      .set(authHeaderFor(owner))
      .send({ ...VALID, page: "not-a-page" });

    expect(response.status).toBe(400);
  });

  it("refuses a duplicate name on the same page", async () => {
    await request(app).post("/api/saved-views").set(authHeaderFor(owner)).send(VALID);
    const duplicate = await request(app)
      .post("/api/saved-views")
      .set(authHeaderFor(owner))
      .send(VALID);

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("CONFLICT");
  });

  it("allows two users to use the same name", async () => {
    await request(app).post("/api/saved-views").set(authHeaderFor(owner)).send(VALID);
    const theirs = await request(app)
      .post("/api/saved-views")
      .set(authHeaderFor(other))
      .send(VALID);

    expect(theirs.status).toBe(201);
  });
});

describe("saved view ownership", () => {
  it("hides a private view from everyone else", async () => {
    await request(app).post("/api/saved-views").set(authHeaderFor(owner)).send(VALID);

    const listed = await request(app)
      .get("/api/saved-views?page=events")
      .set(authHeaderFor(other));

    expect(listed.body).toHaveLength(0);
  });

  it("shows a shared view to everyone", async () => {
    await request(app)
      .post("/api/saved-views")
      .set(authHeaderFor(owner))
      .send({ ...VALID, isShared: true });

    const listed = await request(app)
      .get("/api/saved-views?page=events")
      .set(authHeaderFor(other));

    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].owner.email).toBe(owner.email);
  });

  /**
   * 404 rather than 403 on purpose: a 403 would confirm the id exists, which is
   * a free information leak. From a non-owner's perspective it may as well not.
   */
  it("returns 404, not 403, when a non-owner edits a shared view", async () => {
    const created = await request(app)
      .post("/api/saved-views")
      .set(authHeaderFor(owner))
      .send({ ...VALID, isShared: true });

    const patched = await request(app)
      .patch(`/api/saved-views/${created.body.id}`)
      .set(authHeaderFor(other))
      .send({ name: "hijacked" });

    expect(patched.status).toBe(404);
  });

  it("refuses deletion by a non-owner", async () => {
    const created = await request(app)
      .post("/api/saved-views")
      .set(authHeaderFor(owner))
      .send({ ...VALID, isShared: true });

    const deleted = await request(app)
      .delete(`/api/saved-views/${created.body.id}`)
      .set(authHeaderFor(other));

    expect(deleted.status).toBe(404);
    expect(await prisma.savedView.count()).toBe(1);
  });

  it("lets a system admin delete anyone's view", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN" });
    const created = await request(app)
      .post("/api/saved-views")
      .set(authHeaderFor(owner))
      .send(VALID);

    const deleted = await request(app)
      .delete(`/api/saved-views/${created.body.id}`)
      .set(authHeaderFor(admin));

    expect(deleted.status).toBe(204);
    expect(await prisma.savedView.count()).toBe(0);
  });

  it("writes an audit event for every mutation", async () => {
    const created = await request(app)
      .post("/api/saved-views")
      .set(authHeaderFor(owner))
      .send(VALID);
    await request(app)
      .patch(`/api/saved-views/${created.body.id}`)
      .set(authHeaderFor(owner))
      .send({ name: "Renamed" });
    await request(app)
      .delete(`/api/saved-views/${created.body.id}`)
      .set(authHeaderFor(owner));

    const actions = await prisma.auditEvent.findMany({
      where: { entityType: "SavedView" },
      select: { action: true }
    });

    expect(actions.map((row) => row.action).sort()).toEqual([
      "SAVED_VIEW_CREATED",
      "SAVED_VIEW_DELETED",
      "SAVED_VIEW_UPDATED"
    ]);
  });
});

describe("saved view limits", () => {
  it("caps a user at 50 views", async () => {
    await prisma.savedView.createMany({
      data: Array.from({ length: 50 }, (_, index) => ({
        name: `View ${index}`,
        ownerId: owner.id,
        page: "events",
        filtersJson: {}
      }))
    });

    const response = await request(app)
      .post("/api/saved-views")
      .set(authHeaderFor(owner))
      .send(VALID);

    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/at most 50/i);
  });
});
