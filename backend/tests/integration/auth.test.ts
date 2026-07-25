import request from "supertest";

import { createApp } from "../../src/app.js";
import { prisma } from "../../src/db/prisma.js";
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

describe("auth", () => {
  it("completes the login -> me -> refresh -> logout lifecycle", async () => {
    const user = await createUser({ role: "OPS_MANAGER", email: "ops@example.com" });

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });

    expect(login.status).toBe(200);
    expect(login.body.accessToken).toBeTruthy();
    expect(login.body.refreshToken).toBeTruthy();
    expect(login.body.user).toMatchObject({ email: user.email, role: "OPS_MANAGER" });
    // The password hash must never cross the wire.
    expect(login.body.user.passwordHash).toBeUndefined();

    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${login.body.accessToken}`);

    expect(me.status).toBe(200);
    expect(me.body.id).toBe(user.id);

    const refresh = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: login.body.refreshToken });

    expect(refresh.status).toBe(200);

    const logout = await request(app)
      .post("/api/auth/logout")
      .send({ refreshToken: refresh.body.refreshToken });

    expect(logout.status).toBe(204);
  });

  it("rotates refresh tokens, revoking the presented one at the database level", async () => {
    const user = await createUser({ role: "OPS_MANAGER" });
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });

    const refreshed = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: login.body.refreshToken });

    expect(refreshed.status).toBe(200);

    const stored = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(2);
    expect(stored.filter((token) => token.revokedAt !== null)).toHaveLength(1);
    expect(stored.filter((token) => token.revokedAt === null)).toHaveLength(1);
  });

  it("mints a distinct refresh token every time, even within the same second", async () => {
    const user = await createUser({ role: "OPS_MANAGER" });

    const first = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });
    const second = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });

    // Without a jti these are byte-identical when both land in the same second,
    // because iat has one-second resolution and nothing else in the payload varies.
    expect(first.body.refreshToken).not.toBe(second.body.refreshToken);
  });

  it("rejects a replayed refresh token", async () => {
    const user = await createUser({ role: "OPS_MANAGER" });
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });

    await request(app).post("/api/auth/refresh").send({ refreshToken: login.body.refreshToken });

    const replay = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: login.body.refreshToken });

    expect(replay.status).toBe(401);
  });

  it("revokes the whole token family when a used token is replayed", async () => {
    const user = await createUser({ role: "OPS_MANAGER" });
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });

    const rotated = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: login.body.refreshToken });

    // Replay the old token: we cannot tell an attacker from the victim, so
    // every session for the account ends.
    await request(app).post("/api/auth/refresh").send({ refreshToken: login.body.refreshToken });

    const stillValid = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: rotated.body.refreshToken });

    expect(stillValid.status).toBe(401);

    const active = await prisma.refreshToken.count({
      where: { userId: user.id, revokedAt: null }
    });
    expect(active).toBe(0);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "REFRESH_TOKEN_REUSE_DETECTED", actorId: user.id }
    });
    expect(audit).not.toBeNull();
  });

  it("signs the caller out of every session via logout-all", async () => {
    const user = await createUser({ role: "OPS_MANAGER" });
    const first = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });
    await request(app).post("/api/auth/login").send({ email: user.email, password: TEST_PASSWORD });

    const response = await request(app)
      .post("/api/auth/logout-all")
      .set("Authorization", `Bearer ${first.body.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.revoked).toBe(2);

    const replay = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: first.body.refreshToken });
    expect(replay.status).toBe(401);
  });

  it("stores refresh tokens hashed, never in plaintext", async () => {
    const user = await createUser({ role: "OPS_MANAGER" });
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });

    const stored = await prisma.refreshToken.findFirst({ where: { userId: user.id } });

    expect(stored).not.toBeNull();
    expect(stored!.tokenHash).not.toBe(login.body.refreshToken);
    expect(stored!.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a wrong password with 401 and records a failed-login event", async () => {
    const user = await createUser({ role: "OPS_MANAGER" });

    const response = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "WrongPassword123!" });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");

    const failures = await prisma.trackedEvent.count({ where: { eventType: "USER_LOGIN_FAILED" } });
    expect(failures).toBe(1);
  });

  it("does not reveal whether an email exists", async () => {
    const user = await createUser({ role: "OPS_MANAGER" });

    const wrongPassword = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "WrongPassword123!" });
    const unknownEmail = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: TEST_PASSWORD });

    expect(unknownEmail.status).toBe(wrongPassword.status);
    expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it("refuses login for a deactivated user", async () => {
    const user = await createUser({ role: "OPS_MANAGER", isActive: false });

    const response = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 401 for a malformed refresh token", async () => {
    const response = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: "made-up-token" });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("gives the same answer for every flavour of invalid token", async () => {
    const user = await createUser({ role: "OPS_MANAGER" });
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });
    await request(app).post("/api/auth/logout").send({ refreshToken: login.body.refreshToken });

    // Must clear refreshSchema's min(10): a shorter string is rejected as a
    // malformed *request* (400) before the handler ever sees it, which is a
    // different — and correct — answer.
    const malformed = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: "not-a-valid-token-at-all" });
    const revoked = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: login.body.refreshToken });

    // Identical responses, so the endpoint does not reveal which kind of
    // invalid a token was.
    expect(malformed.status).toBe(revoked.status);
    expect(malformed.body.error.message).toBe(revoked.body.error.message);
  });
});
