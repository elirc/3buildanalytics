import { ExportStatus } from "@prisma/client";
import request from "supertest";

import { createApp } from "../../src/app.js";
import { prisma } from "../../src/db/prisma.js";
import { exportsService } from "../../src/modules/exports/exports.service.js";
import { authHeaderFor } from "../helpers/auth.js";
import { disconnectDatabase, resetDatabase } from "../helpers/db.js";
import { createExportJob, createTrackedEvents, createUser } from "../helpers/factories.js";

const app = createApp();

const WINDOW = { startDate: "2026-01-01", endDate: "2026-01-31" };
const IN_RANGE = new Date("2026-01-15T12:00:00.000Z");

let user: Awaited<ReturnType<typeof createUser>>;

beforeEach(async () => {
  await resetDatabase();
  user = await createUser({ role: "OPS_MANAGER" });
});

afterAll(async () => {
  await resetDatabase();
  await disconnectDatabase();
});

describe("export retry", () => {
  /**
   * The bug: retry() reset the failed job to PENDING and then called create(),
   * which inserted a SECOND job. The original stayed PENDING forever, and since
   * queue depth is counted from PENDING rows the engineering dashboard's
   * backlog climbed on every retry and never came down.
   */
  it("reuses the same row instead of creating a second job", async () => {
    await createTrackedEvents({ count: 2, occurredAt: IN_RANGE });
    const failed = await createExportJob({
      requestedById: user.id,
      status: ExportStatus.FAILED,
      filtersJson: WINDOW
    });

    const response = await request(app)
      .post(`/api/exports/${failed.id}/retry`)
      .set(authHeaderFor(user));

    expect(response.status).toBe(200);
    expect(await prisma.exportJob.count()).toBe(1);

    const after = await prisma.exportJob.findUniqueOrThrow({ where: { id: failed.id } });
    expect(after.status).toBe(ExportStatus.COMPLETED);
    expect(after.retryCount).toBe(1);
  });

  it("leaves no permanently-pending rows behind", async () => {
    await createTrackedEvents({ count: 2, occurredAt: IN_RANGE });
    const failed = await createExportJob({
      requestedById: user.id,
      status: ExportStatus.FAILED,
      filtersJson: WINDOW
    });

    await request(app).post(`/api/exports/${failed.id}/retry`).set(authHeaderFor(user));

    const stuck = await prisma.exportJob.count({ where: { status: ExportStatus.PENDING } });
    expect(stuck).toBe(0);
  });

  it("refuses a fourth retry", async () => {
    const failed = await createExportJob({
      requestedById: user.id,
      status: ExportStatus.FAILED,
      filtersJson: WINDOW
    });
    await prisma.exportJob.update({ where: { id: failed.id }, data: { retryCount: 3 } });

    const response = await request(app)
      .post(`/api/exports/${failed.id}/retry`)
      .set(authHeaderFor(user));

    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/retried 3 times/i);
  });

  it("refuses to retry a job that did not fail", async () => {
    const completed = await createExportJob({
      requestedById: user.id,
      status: ExportStatus.COMPLETED,
      filtersJson: WINDOW
    });

    const response = await request(app)
      .post(`/api/exports/${completed.id}/retry`)
      .set(authHeaderFor(user));

    expect(response.status).toBe(400);
  });

  it("refuses to retry someone else's export", async () => {
    const stranger = await createUser({ role: "OPS_MANAGER" });
    const failed = await createExportJob({
      requestedById: user.id,
      status: ExportStatus.FAILED,
      filtersJson: WINDOW
    });

    const response = await request(app)
      .post(`/api/exports/${failed.id}/retry`)
      .set(authHeaderFor(stranger));

    expect(response.status).toBe(404);
  });
});

describe("export processing is idempotent", () => {
  /**
   * BullMQ retries on failure and can redeliver, and the synchronous path can
   * race a worker holding the same job. Without a claim, one user action
   * produced two CSVs and two of every side-effect event.
   */
  it("produces one set of side effects when processed twice", async () => {
    await createTrackedEvents({ count: 3, occurredAt: IN_RANGE });
    const job = await createExportJob({
      requestedById: user.id,
      status: ExportStatus.PENDING,
      filtersJson: WINDOW
    });

    await exportsService.processJob(job.id, { requestedById: user.id, requestedByRole: user.role });
    await exportsService.processJob(job.id, { requestedById: user.id, requestedByRole: user.role });

    const exportedEvents = await prisma.trackedEvent.count({ where: { eventType: "CSV_EXPORTED" } });
    const completions = await prisma.auditEvent.count({ where: { action: "EXPORT_COMPLETED" } });

    expect(exportedEvents).toBe(1);
    expect(completions).toBe(1);
  });

  it("runs concurrent claims exactly once", async () => {
    await createTrackedEvents({ count: 3, occurredAt: IN_RANGE });
    const job = await createExportJob({
      requestedById: user.id,
      status: ExportStatus.PENDING,
      filtersJson: WINDOW
    });

    await Promise.all([
      exportsService.processJob(job.id, { requestedById: user.id, requestedByRole: user.role }),
      exportsService.processJob(job.id, { requestedById: user.id, requestedByRole: user.role })
    ]);

    const completions = await prisma.auditEvent.count({ where: { action: "EXPORT_COMPLETED" } });
    expect(completions).toBe(1);
  });
});
