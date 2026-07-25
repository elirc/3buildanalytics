import { randomUUID } from "node:crypto";

import express from "express";
import request from "supertest";

import { errorMiddleware } from "../../src/middleware/error.middleware.js";
import { rateLimit } from "../../src/middleware/rateLimit.middleware.js";
import { getRedisClient } from "../../src/cache/redis.js";
import { disconnectDatabase, resetDatabase } from "../helpers/db.js";

/**
 * These tests need Redis: the limiter is Redis-backed and fails open without
 * it, so with no Redis every assertion about *limiting* would be vacuous.
 *
 * Rather than pretend, they detect availability once and skip the enforcement
 * cases when it is missing — while still running the fail-open case, which is
 * the behaviour that matters when Redis is gone. CI has Redis, so enforcement
 * is always covered there.
 */
let redisAvailable = false;

/**
 * Establish the connection before probing it.
 *
 * The cache client is built with lazyConnect and enableOfflineQueue: false
 * (US-20), so the very first command is rejected outright while the socket is
 * still being established. A bare ping() therefore reported "no Redis" on a
 * perfectly healthy CI runner — and because the enforcement tests skip when
 * that flag is false, all six of them silently did nothing while appearing
 * green. Tests that skip quietly are worse than tests that fail: they report
 * success for work they never performed.
 */
beforeAll(async () => {
  const client = getRedisClient();

  try {
    if (client.status !== "ready") {
      await client.connect().catch(() => undefined);
    }

    // A couple of attempts, because "connecting" is a normal transient state.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await client.ping();
        redisAvailable = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  } catch {
    redisAvailable = false;
  }
});

/** Guards against the skip-everything failure mode described above. */
it("knows whether Redis is available", () => {
  // In CI this must be true: the workflow runs a redis service, and a suite
  // that skips its own subject is not a passing suite.
  if (process.env.CI) {
    expect(redisAvailable).toBe(true);
  }
});

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnectDatabase();
});

/** A tiny app so the limiter can be tested without dragging in the real routes. */
function appWith(options: Parameters<typeof rateLimit>[0], user?: { id: string }) {
  const app = express();
  app.use(express.json());
  if (user) {
    app.use((req, _res, next) => {
      (req as unknown as { user: unknown }).user = { ...user, email: "a@b.c", role: "READ_ONLY" };
      next();
    });
  }
  app.use(rateLimit(options));
  app.get("/probe", (_req, res) => res.status(200).json({ ok: true }));
  app.use(errorMiddleware);
  return app;
}

describe("rate limiting", () => {
  it("allows requests up to the limit and rejects the next one", async () => {
    if (!redisAvailable) return;

    const app = appWith({ points: 3, windowMs: 60_000, bucket: `t-${randomUUID()}` });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const allowed = await request(app).get("/probe");
      expect(allowed.status).toBe(200);
    }

    const blocked = await request(app).get("/probe");
    expect(blocked.status).toBe(429);
    // Distinct from FORBIDDEN: retrying after a rate limit is the correct
    // client behaviour, retrying after a permission failure is not.
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
    expect(blocked.headers["retry-after"]).toBeDefined();
  });

  it("reports remaining budget in the headers", async () => {
    if (!redisAvailable) return;

    const app = appWith({ points: 5, windowMs: 60_000, bucket: `t-${randomUUID()}` });

    const first = await request(app).get("/probe");
    expect(first.headers["x-ratelimit-limit"]).toBe("5");
    expect(first.headers["x-ratelimit-remaining"]).toBe("4");

    const second = await request(app).get("/probe");
    expect(second.headers["x-ratelimit-remaining"]).toBe("3");
  });

  /**
   * The regression the old IP-keyed limiter had: an office behind one NAT
   * shared a single budget, so one busy colleague throttled everyone.
   */
  it("gives authenticated users independent budgets", async () => {
    if (!redisAvailable) return;

    const bucket = `t-${randomUUID()}`;
    const alice = appWith({ points: 2, windowMs: 60_000, bucket }, { id: "alice" });
    const bob = appWith({ points: 2, windowMs: 60_000, bucket }, { id: "bob" });

    await request(alice).get("/probe");
    await request(alice).get("/probe");
    expect((await request(alice).get("/probe")).status).toBe(429);

    // Same IP, different user — must still be allowed.
    expect((await request(bob).get("/probe")).status).toBe(200);
  });

  it("keys on IP when told to, even for an authenticated caller", async () => {
    if (!redisAvailable) return;

    const bucket = `t-${randomUUID()}`;
    const alice = appWith(
      { points: 1, windowMs: 60_000, bucket, keyByIpOnly: true },
      { id: "alice" }
    );
    const bob = appWith({ points: 1, windowMs: 60_000, bucket, keyByIpOnly: true }, { id: "bob" });

    expect((await request(alice).get("/probe")).status).toBe(200);
    // Different user, same IP — shares the budget, which is the point for
    // credential endpoints.
    expect((await request(bob).get("/probe")).status).toBe(429);
  });

  it("keeps separate buckets separate", async () => {
    if (!redisAvailable) return;

    const bucketOne = `t-${randomUUID()}`;
    const bucketTwo = `t-${randomUUID()}`;

    const one = appWith({ points: 1, windowMs: 60_000, bucket: bucketOne });
    const two = appWith({ points: 1, windowMs: 60_000, bucket: bucketTwo });

    expect((await request(one).get("/probe")).status).toBe(200);
    expect((await request(one).get("/probe")).status).toBe(429);
    // A different tier must not have been consumed by the first.
    expect((await request(two).get("/probe")).status).toBe(200);
  });

  it("starts a fresh budget in the next window", async () => {
    if (!redisAvailable) return;

    // A 1ms window is already over by the time the second request arrives.
    const app = appWith({ points: 1, windowMs: 1, bucket: `t-${randomUUID()}` });

    expect((await request(app).get("/probe")).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await request(app).get("/probe")).status).toBe(200);
  });
});

describe("rate limiting when Redis is unavailable", () => {
  /**
   * Availability over enforcement. A limiter that rejects everything when its
   * own dependency is down turns a Redis outage into a full outage.
   */
  it("fails open rather than rejecting traffic", async () => {
    // Only meaningful without Redis. With Redis the limiter enforces, which
    // the first test in this file already proves — asserting it again here
    // added nothing and made the test depend on cross-test bucket state.
    if (redisAvailable) {
      return;
    }

    const app = appWith({
      points: 1,
      windowMs: 60_000,
      bucket: `t-${randomUUID()}`
    });

    // Both served despite points: 1, because the limiter cannot reach Redis
    // and chooses availability over enforcement.
    expect((await request(app).get("/probe")).status).toBe(200);
    expect((await request(app).get("/probe")).status).toBe(200);
  });
});
