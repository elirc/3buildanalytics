import request from "supertest";

import { createApp } from "../../src/app.js";
import { prisma } from "../../src/db/prisma.js";
import { authHeaderFor } from "../helpers/auth.js";
import { disconnectDatabase, resetDatabase } from "../helpers/db.js";
import { TEST_PASSWORD, createUser } from "../helpers/factories.js";

const app = createApp();

let admin: Awaited<ReturnType<typeof createUser>>;

beforeEach(async () => {
  await resetDatabase();
  admin = await createUser({ role: "SYSTEM_ADMIN", email: "admin@example.com" });
});

afterAll(async () => {
  await resetDatabase();
  await disconnectDatabase();
});

describe("creating users", () => {
  it("creates a user with the requested role and audits it", async () => {
    const response = await request(app)
      .post("/api/users")
      .set(authHeaderFor(admin))
      .send({
        email: "New.Person@Example.com",
        password: "Password123!",
        firstName: "New",
        lastName: "Person",
        role: "OPS_MANAGER"
      });

    expect(response.status).toBe(201);
    // Emails are normalised, or "Bob@x.com" and "bob@x.com" become two accounts.
    expect(response.body.email).toBe("new.person@example.com");
    expect(response.body.role).toBe("OPS_MANAGER");
    expect(response.body.passwordHash).toBeUndefined();

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "USER_CREATED", actorId: admin.id }
    });
    expect(audit).not.toBeNull();
  });

  it("refuses a duplicate email", async () => {
    await createUser({ email: "taken@example.com", role: "READ_ONLY" });

    const response = await request(app)
      .post("/api/users")
      .set(authHeaderFor(admin))
      .send({
        email: "taken@example.com",
        password: "Password123!",
        firstName: "A",
        lastName: "B",
        role: "READ_ONLY"
      });

    expect(response.status).toBe(409);
  });
});

/**
 * POST /api/auth/register is unauthenticated. It used to honour whatever role
 * the body asked for, so anyone who could reach the API could mint themselves a
 * SYSTEM_ADMIN.
 */
describe("public registration cannot escalate", () => {
  it("forces READ_ONLY no matter what role is requested", async () => {
    const response = await request(app).post("/api/auth/register").send({
      email: "attacker@example.com",
      password: "Password123!",
      firstName: "A",
      lastName: "B",
      role: "SYSTEM_ADMIN"
    });

    expect(response.status).toBe(201);
    expect(response.body.user.role).toBe("READ_ONLY");

    const stored = await prisma.user.findUnique({ where: { email: "attacker@example.com" } });
    expect(stored!.role).toBe("READ_ONLY");
  });
});

describe("updating users", () => {
  it("changes a role and records before/after in the audit trail", async () => {
    const target = await createUser({ role: "READ_ONLY" });

    const response = await request(app)
      .patch(`/api/users/${target.id}`)
      .set(authHeaderFor(admin))
      .send({ role: "OPS_MANAGER" });

    expect(response.status).toBe(200);
    expect(response.body.role).toBe("OPS_MANAGER");

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "USER_ROLE_CHANGED", entityId: target.id }
    });
    expect(audit).not.toBeNull();
    expect(audit!.metadata).toMatchObject({
      changes: { role: { from: "READ_ONLY", to: "OPS_MANAGER" } }
    });
  });

  it("refuses to let an admin change their own role", async () => {
    const response = await request(app)
      .patch(`/api/users/${admin.id}`)
      .set(authHeaderFor(admin))
      .send({ role: "READ_ONLY" });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/your own role/i);
  });

  it("refuses to let an admin deactivate themselves", async () => {
    const response = await request(app)
      .patch(`/api/users/${admin.id}`)
      .set(authHeaderFor(admin))
      .send({ isActive: false });

    expect(response.status).toBe(400);
  });

  it("refuses to demote the last active system admin", async () => {
    const secondAdmin = await createUser({ role: "SYSTEM_ADMIN" });

    // Demoting one is fine while another remains.
    const first = await request(app)
      .patch(`/api/users/${secondAdmin.id}`)
      .set(authHeaderFor(admin))
      .send({ role: "READ_ONLY" });
    expect(first.status).toBe(200);

    // Now `admin` is the only one left, and only another admin could demote
    // them — so promote a third and try again from there.
    const third = await createUser({ role: "SYSTEM_ADMIN" });
    await request(app)
      .patch(`/api/users/${third.id}`)
      .set(authHeaderFor(admin))
      .send({ role: "READ_ONLY" });

    const lastOne = await request(app)
      .patch(`/api/users/${admin.id}`)
      .set(authHeaderFor(admin))
      .send({ isActive: false });

    expect(lastOne.status).toBe(400);
  });

  it("deactivating revokes every refresh token so existing sessions die", async () => {
    const target = await createUser({ role: "OPS_MANAGER" });
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: target.email, password: TEST_PASSWORD });

    expect(login.status).toBe(200);

    await request(app)
      .patch(`/api/users/${target.id}`)
      .set(authHeaderFor(admin))
      .send({ isActive: false });

    const refreshed = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: login.body.refreshToken });
    expect(refreshed.status).toBe(401);

    const relogin = await request(app)
      .post("/api/auth/login")
      .send({ email: target.email, password: TEST_PASSWORD });
    expect(relogin.status).toBe(403);
  });

  it("reactivates a user", async () => {
    const target = await createUser({ role: "OPS_MANAGER", isActive: false });

    const response = await request(app)
      .patch(`/api/users/${target.id}`)
      .set(authHeaderFor(admin))
      .send({ isActive: true });

    expect(response.status).toBe(200);
    const audit = await prisma.auditEvent.findFirst({
      where: { action: "USER_REACTIVATED", entityId: target.id }
    });
    expect(audit).not.toBeNull();
  });

  it("rejects an empty patch", async () => {
    const target = await createUser({ role: "READ_ONLY" });

    const response = await request(app)
      .patch(`/api/users/${target.id}`)
      .set(authHeaderFor(admin))
      .send({});

    expect(response.status).toBe(400);
  });

  it("404s for an unknown user", async () => {
    const response = await request(app)
      .patch("/api/users/00000000-0000-0000-0000-000000000000")
      .set(authHeaderFor(admin))
      .send({ role: "READ_ONLY" });

    expect(response.status).toBe(404);
  });
});

describe("listing users", () => {
  it("filters by search and role and never returns password hashes", async () => {
    await createUser({ role: "OPS_MANAGER", email: "alice@example.com", firstName: "Alice" });
    await createUser({ role: "READ_ONLY", email: "bob@example.com", firstName: "Bob" });

    const search = await request(app)
      .get("/api/users?search=alice")
      .set(authHeaderFor(admin));
    expect(search.body.items).toHaveLength(1);
    expect(search.body.items[0].email).toBe("alice@example.com");
    expect(search.body.items[0].passwordHash).toBeUndefined();

    const byRole = await request(app)
      .get("/api/users?role=READ_ONLY")
      .set(authHeaderFor(admin));
    expect(byRole.body.items.every((user: { role: string }) => user.role === "READ_ONLY")).toBe(true);
  });

  it("filters by active state, treating the query string as text", async () => {
    await createUser({ role: "READ_ONLY", isActive: false });

    const inactive = await request(app)
      .get("/api/users?isActive=false")
      .set(authHeaderFor(admin));

    expect(inactive.body.items).toHaveLength(1);
    expect(inactive.body.items[0].isActive).toBe(false);
  });
});
