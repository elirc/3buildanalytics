import { promises as fs } from "node:fs";
import path from "node:path";

import { ExportStatus } from "@prisma/client";
import request from "supertest";

import { createApp } from "../../src/app.js";
import { env } from "../../src/config/env.js";
import { prisma } from "../../src/db/prisma.js";
import { exportCleanupService } from "../../src/modules/exports/exportCleanup.service.js";
import { authHeaderFor } from "../helpers/auth.js";
import { disconnectDatabase, resetDatabase } from "../helpers/db.js";
import { createExportJob, createTrackedEvents, createUser } from "../helpers/factories.js";

const app = createApp();

const WINDOW = { startDate: "2026-01-01", endDate: "2026-01-31" };
const IN_RANGE = new Date("2026-01-15T12:00:00.000Z");

const storageDir = path.resolve(process.cwd(), env.EXPORT_STORAGE_DIR);

async function writeArtifact(name: string) {
  await fs.mkdir(storageDir, { recursive: true });
  await fs.writeFile(path.join(storageDir, name), "id,value\n1,2\n", "utf8");
}

let owner: Awaited<ReturnType<typeof createUser>>;
let admin: Awaited<ReturnType<typeof createUser>>;

beforeEach(async () => {
  await resetDatabase();
  owner = await createUser({ role: "OPS_MANAGER" });
  admin = await createUser({ role: "SYSTEM_ADMIN" });
});

afterAll(async () => {
  await resetDatabase();
  await disconnectDatabase();
});

describe("export retention sweep", () => {
  it("expires a job past its window and deletes the file", async () => {
    const fileName = "retention-expired.csv";
    await writeArtifact(fileName);

    const job = await createExportJob({
      requestedById: owner.id,
      status: ExportStatus.COMPLETED,
      fileName,
      expiresAt: new Date(Date.now() - 60_000)
    });

    const result = await exportCleanupService.run();

    expect(result.expired).toBe(1);
    expect(result.filesDeleted).toBe(1);

    const after = await prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe(ExportStatus.EXPIRED);
    // A row must never advertise an artifact it no longer has.
    expect(after.fileName).toBeNull();
    expect(after.fileUrl).toBeNull();

    await expect(fs.access(path.join(storageDir, fileName))).rejects.toThrow();
  });

  it("leaves a job whose window has not passed alone", async () => {
    const job = await createExportJob({
      requestedById: owner.id,
      status: ExportStatus.COMPLETED,
      fileName: "still-fresh.csv",
      expiresAt: new Date(Date.now() + 86_400_000)
    });

    await exportCleanupService.run();

    const after = await prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe(ExportStatus.COMPLETED);
  });

  it("treats an already-missing file as success", async () => {
    const job = await createExportJob({
      requestedById: owner.id,
      status: ExportStatus.COMPLETED,
      fileName: "never-written.csv",
      expiresAt: new Date(Date.now() - 60_000)
    });

    const result = await exportCleanupService.run();

    expect(result.expired).toBe(1);
    expect(result.filesDeleted).toBe(0);

    const after = await prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe(ExportStatus.EXPIRED);
  });

  it("is safe to run repeatedly", async () => {
    await createExportJob({
      requestedById: owner.id,
      status: ExportStatus.COMPLETED,
      fileName: "twice.csv",
      expiresAt: new Date(Date.now() - 60_000)
    });

    await exportCleanupService.run();
    const second = await exportCleanupService.run();

    expect(second.expired).toBe(0);
  });
});

describe("downloading a missing or expired export", () => {
  it("returns a clean 404 rather than an unhandled stream error", async () => {
    const job = await createExportJob({
      requestedById: owner.id,
      status: ExportStatus.COMPLETED,
      fileName: "gone.csv"
    });
    await prisma.exportJob.update({
      where: { id: job.id },
      data: { fileUrl: "http://localhost:4000/api/exports/x/download" }
    });

    const response = await request(app)
      .get(`/api/exports/${job.id}/download`)
      .set(authHeaderFor(owner));

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("explains that an expired export is gone", async () => {
    const job = await createExportJob({
      requestedById: owner.id,
      status: ExportStatus.EXPIRED
    });

    const response = await request(app)
      .get(`/api/exports/${job.id}/download`)
      .set(authHeaderFor(owner));

    expect(response.status).toBe(404);
    expect(response.body.error.message).toMatch(/expired/i);
  });
});

describe("admin visibility", () => {
  it("lets an admin list everyone's exports with ?all=true", async () => {
    await createExportJob({ requestedById: owner.id, status: ExportStatus.PENDING });

    const adminView = await request(app)
      .get("/api/exports?all=true")
      .set(authHeaderFor(admin));
    const ownView = await request(app).get("/api/exports").set(authHeaderFor(admin));

    expect(adminView.body).toHaveLength(1);
    expect(adminView.body[0].requestedBy.email).toBe(owner.email);
    // The admin has no exports of their own.
    expect(ownView.body).toHaveLength(0);
  });

  it("ignores ?all=true for non-admins instead of erroring", async () => {
    await createExportJob({ requestedById: admin.id, status: ExportStatus.PENDING });

    const response = await request(app)
      .get("/api/exports?all=true")
      .set(authHeaderFor(owner));

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(0);
  });

  it("audits an admin downloading someone else's export", async () => {
    await createTrackedEvents({ count: 2, occurredAt: IN_RANGE });
    const created = await request(app)
      .post("/api/exports")
      .set(authHeaderFor(owner))
      .send({ exportType: "TRACKED_EVENTS", filters: WINDOW });

    expect(created.status).toBe(201);

    const download = await request(app)
      .get(`/api/exports/${created.body.id}/download`)
      .set(authHeaderFor(admin));

    expect(download.status).toBe(200);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "EXPORT_DOWNLOADED_BY_ADMIN", actorId: admin.id }
    });
    expect(audit).not.toBeNull();
    expect(audit!.metadata).toMatchObject({ requestedById: owner.id });
  });

  it("still hides other users' exports from non-admins", async () => {
    const job = await createExportJob({ requestedById: admin.id, status: ExportStatus.PENDING });

    const response = await request(app)
      .get(`/api/exports/${job.id}`)
      .set(authHeaderFor(owner));

    expect(response.status).toBe(404);
  });
});
