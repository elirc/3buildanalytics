import { Role } from "@prisma/client";
import request from "supertest";

import { createApp } from "../../src/app.js";
import { PERMISSIONS } from "../../src/shared/permissions.js";
import { authHeaderFor } from "../helpers/auth.js";
import { disconnectDatabase, resetDatabase } from "../helpers/db.js";
import { TEST_PASSWORD, createUser } from "../helpers/factories.js";

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await resetDatabase();
  await disconnectDatabase();
});

describe("GET /api/auth/permissions", () => {
  it.each(Object.values(Role))("returns the exact matrix entry for %s", async (role) => {
    const user = await createUser({ role });

    const response = await request(app).get("/api/auth/permissions").set(authHeaderFor(user));

    expect(response.status).toBe(200);
    expect(response.body.role).toBe(role);
    expect([...response.body.permissions].sort()).toEqual([...PERMISSIONS[role]].sort());
  });

  it("requires authentication", async () => {
    const response = await request(app).get("/api/auth/permissions");
    expect(response.status).toBe(401);
  });
});

describe("session payloads carry permissions", () => {
  it("includes them on login so the UI can render nav on first paint", async () => {
    const user = await createUser({ role: "ENGINEERING_ADMIN" });

    const response = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });

    expect(response.status).toBe(200);
    expect([...response.body.user.permissions].sort()).toEqual(
      [...PERMISSIONS.ENGINEERING_ADMIN].sort()
    );
  });

  it("includes them on /me", async () => {
    const user = await createUser({ role: "AUDIT_VIEWER" });

    const response = await request(app).get("/api/auth/me").set(authHeaderFor(user));

    expect(response.status).toBe(200);
    expect([...response.body.permissions].sort()).toEqual([...PERMISSIONS.AUDIT_VIEWER].sort());
  });

  it("never leaks the password hash alongside them", async () => {
    const user = await createUser({ role: "SYSTEM_ADMIN" });

    const response = await request(app).get("/api/auth/me").set(authHeaderFor(user));

    expect(response.body.passwordHash).toBeUndefined();
  });
});
