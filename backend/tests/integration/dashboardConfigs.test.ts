import request from "supertest";

import { createApp } from "../../src/app.js";
import { prisma } from "../../src/db/prisma.js";
import { authHeaderFor } from "../helpers/auth.js";
import { disconnectDatabase, resetDatabase } from "../helpers/db.js";
import { createUser } from "../helpers/factories.js";

const app = createApp();

const VALID_LAYOUT = {
  widgets: [
    { id: "kpi-summary", size: "full" },
    { id: "events-over-time", size: "half" }
  ]
};

let admin: Awaited<ReturnType<typeof createUser>>;

beforeEach(async () => {
  await resetDatabase();
  admin = await createUser({ role: "SYSTEM_ADMIN" });
});

afterAll(async () => {
  await resetDatabase();
  await disconnectDatabase();
});

describe("layout validation", () => {
  it("accepts a valid layout", async () => {
    const response = await request(app)
      .post("/api/dashboard-configs")
      .set(authHeaderFor(admin))
      .send({ name: "Ops", role: "OPS_MANAGER", layoutJson: VALID_LAYOUT });

    expect(response.status).toBe(201);
  });

  /**
   * layoutJson used to be z.record(z.unknown()) — any JSON at all. Harmless
   * while nothing rendered from it; now it drives the dashboard, so an unknown
   * id would produce a blank card with no explanation.
   */
  it("rejects an unknown widget id", async () => {
    const response = await request(app)
      .post("/api/dashboard-configs")
      .set(authHeaderFor(admin))
      .send({
        name: "Bad",
        role: "OPS_MANAGER",
        layoutJson: { widgets: [{ id: "not-a-widget", size: "full" }] }
      });

    expect(response.status).toBe(400);
  });

  it("rejects the old bare-string layout shape", async () => {
    const response = await request(app)
      .post("/api/dashboard-configs")
      .set(authHeaderFor(admin))
      .send({
        name: "Legacy",
        role: "OPS_MANAGER",
        layoutJson: { widgets: ["kpi-summary"] }
      });

    expect(response.status).toBe(400);
  });

  it("rejects unknown top-level keys", async () => {
    const response = await request(app)
      .post("/api/dashboard-configs")
      .set(authHeaderFor(admin))
      .send({
        name: "Extra",
        role: "OPS_MANAGER",
        layoutJson: { widgets: [], theme: "dark" }
      });

    expect(response.status).toBe(400);
  });
});

describe("default layout for a role", () => {
  it("returns the role's default config", async () => {
    await request(app)
      .post("/api/dashboard-configs")
      .set(authHeaderFor(admin))
      .send({ name: "Ops", role: "OPS_MANAGER", layoutJson: VALID_LAYOUT, isDefault: true });

    const ops = await createUser({ role: "OPS_MANAGER" });
    const response = await request(app)
      .get("/api/dashboard-configs/default")
      .set(authHeaderFor(ops));

    expect(response.status).toBe(200);
    expect(response.body.layoutJson.widgets).toHaveLength(2);
  });

  it("returns null when a role has no config, rather than 404", async () => {
    const ops = await createUser({ role: "OPS_MANAGER" });

    const response = await request(app)
      .get("/api/dashboard-configs/default")
      .set(authHeaderFor(ops));

    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
  });

  /**
   * A saved config must not become a way to hand a monitoring widget to a role
   * without monitoring:view.
   */
  it("strips widgets the viewer's role cannot see", async () => {
    await request(app)
      .post("/api/dashboard-configs")
      .set(authHeaderFor(admin))
      .send({
        name: "Mixed",
        role: "OPS_MANAGER",
        isDefault: true,
        layoutJson: {
          widgets: [
            { id: "kpi-summary", size: "full" },
            { id: "queue-depth", size: "half" },
            { id: "api-latency", size: "half" }
          ]
        }
      });

    const ops = await createUser({ role: "OPS_MANAGER" });
    const response = await request(app)
      .get("/api/dashboard-configs/default")
      .set(authHeaderFor(ops));

    // OPS_MANAGER lacks monitoring:view, so only the KPI widget survives.
    expect(response.body.layoutJson.widgets.map((w: { id: string }) => w.id)).toEqual([
      "kpi-summary"
    ]);
  });

  it("keeps monitoring widgets for a role that may see them", async () => {
    await request(app)
      .post("/api/dashboard-configs")
      .set(authHeaderFor(admin))
      .send({
        name: "Eng",
        role: "ENGINEERING_ADMIN",
        isDefault: true,
        layoutJson: { widgets: [{ id: "api-latency", size: "half" }] }
      });

    const engineer = await createUser({ role: "ENGINEERING_ADMIN" });
    const response = await request(app)
      .get("/api/dashboard-configs/default")
      .set(authHeaderFor(engineer));

    expect(response.body.layoutJson.widgets).toHaveLength(1);
  });

  it("is readable with dashboard:view alone", async () => {
    const readOnly = await createUser({ role: "READ_ONLY" });

    const response = await request(app)
      .get("/api/dashboard-configs/default")
      .set(authHeaderFor(readOnly));

    // READ_ONLY cannot configure dashboards but must be able to read its layout.
    expect(response.status).toBe(200);
  });
});

describe("one default per role", () => {
  it("unsets the previous default when a new one is set", async () => {
    const first = await request(app)
      .post("/api/dashboard-configs")
      .set(authHeaderFor(admin))
      .send({ name: "First", role: "OPS_MANAGER", layoutJson: VALID_LAYOUT, isDefault: true });
    const second = await request(app)
      .post("/api/dashboard-configs")
      .set(authHeaderFor(admin))
      .send({ name: "Second", role: "OPS_MANAGER", layoutJson: VALID_LAYOUT });

    await request(app)
      .patch(`/api/dashboard-configs/${second.body.id}`)
      .set(authHeaderFor(admin))
      .send({ role: "OPS_MANAGER", isDefault: true });

    const rows = await prisma.dashboardConfig.findMany({ where: { role: "OPS_MANAGER" } });
    const defaults = rows.filter((row) => row.isDefault);

    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.id).toBe(second.body.id);
    expect(rows.find((row) => row.id === first.body.id)!.isDefault).toBe(false);
  });
});
