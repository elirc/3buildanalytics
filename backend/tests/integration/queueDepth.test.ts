import { ExportStatus } from "@prisma/client";
import request from "supertest";

import { createApp } from "../../src/app.js";
import { authHeaderFor } from "../helpers/auth.js";
import { disconnectDatabase, resetDatabase } from "../helpers/db.js";
import { createExportJob, createUser } from "../helpers/factories.js";

const app = createApp();

let engineer: Awaited<ReturnType<typeof createUser>>;

beforeEach(async () => {
  await resetDatabase();
  engineer = await createUser({ role: "ENGINEERING_ADMIN" });
});

afterAll(async () => {
  await resetDatabase();
  await disconnectDatabase();
});

describe("queue depth", () => {
  it("reports database-derived counts", async () => {
    await createExportJob({ requestedById: engineer.id, status: ExportStatus.PENDING });
    await createExportJob({ requestedById: engineer.id, status: ExportStatus.PENDING });
    await createExportJob({ requestedById: engineer.id, status: ExportStatus.FAILED });

    const response = await request(app)
      .get("/api/monitoring/queue-depth")
      .set(authHeaderFor(engineer));

    expect(response.status).toBe(200);
    expect(response.body.jobs.pending).toBe(2);
    expect(response.body.jobs.failed).toBe(1);
    expect(response.body.jobs.total).toBe(3);
  });

  it("keeps the flat shape existing callers read", async () => {
    await createExportJob({ requestedById: engineer.id, status: ExportStatus.PENDING });

    const response = await request(app)
      .get("/api/monitoring/queue-depth")
      .set(authHeaderFor(engineer));

    // The engineering dashboard reads `.total` directly.
    expect(response.body.total).toBe(1);
  });

  it("reports both sources and whether Redis answered", async () => {
    const response = await request(app)
      .get("/api/monitoring/queue-depth")
      .set(authHeaderFor(engineer));

    expect(response.body).toHaveProperty("jobs");
    expect(response.body).toHaveProperty("queue");
    expect(response.body).toHaveProperty("redisAvailable");
    expect(typeof response.body.redisAvailable).toBe("boolean");
  });

  /**
   * The whole point: a monitoring endpoint must not fail because the thing it
   * monitors is unavailable — that is exactly when someone is looking at it.
   *
   * Passes whether or not Redis is running: with it, `queue` is populated;
   * without it, `queue` is null and `redisAvailable` is false. Either way the
   * database counts are served and the status is 200.
   */
  it("serves database counts even when the queue cannot be reached", async () => {
    await createExportJob({ requestedById: engineer.id, status: ExportStatus.PENDING });

    const response = await request(app)
      .get("/api/monitoring/queue-depth")
      .set(authHeaderFor(engineer));

    expect(response.status).toBe(200);
    expect(response.body.jobs.pending).toBe(1);

    if (response.body.redisAvailable) {
      expect(response.body.queue).not.toBeNull();
      expect(typeof response.body.queue.waiting).toBe("number");
    } else {
      expect(response.body.queue).toBeNull();
    }
  });
});

describe("readiness probe", () => {
  it("reports ready with a per-dependency breakdown", async () => {
    const response = await request(app).get("/health/ready");

    // Postgres is up in tests, so the instance is ready regardless of Redis.
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ready");
    expect(response.body.checks.database.ok).toBe(true);
    expect(response.body.checks).toHaveProperty("redis");
  });

  it("does not fail readiness merely because Redis is missing", async () => {
    const response = await request(app).get("/health/ready");

    // The app is designed to degrade without Redis, so it must not be taken out
    // of rotation for that alone.
    expect(response.status).toBe(200);
  });

  it("keeps liveness independent of dependencies", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});
