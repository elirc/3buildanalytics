import { AlertStatus } from "@prisma/client";
import request from "supertest";

import { createApp } from "../../src/app.js";
import { prisma } from "../../src/db/prisma.js";
import { alertsService } from "../../src/modules/alerts/alerts.service.js";
import { authHeaderFor } from "../helpers/auth.js";
import { disconnectDatabase, resetDatabase } from "../helpers/db.js";
import { createMonitoringMetric, createUser } from "../helpers/factories.js";

const app = createApp();

let engineer: Awaited<ReturnType<typeof createUser>>;

async function createRule(overrides: Partial<{ threshold: number; windowMinutes: number }> = {}) {
  return alertsService.createRule({
    name: "Latency too high",
    metricType: "API_LATENCY",
    comparator: "GREATER_THAN",
    threshold: overrides.threshold ?? 100,
    windowMinutes: overrides.windowMinutes ?? 15,
    createdById: engineer.id
  });
}

beforeEach(async () => {
  await resetDatabase();
  engineer = await createUser({ role: "ENGINEERING_ADMIN" });
});

afterAll(async () => {
  await resetDatabase();
  await disconnectDatabase();
});

describe("alert evaluation", () => {
  it("fires when the windowed average crosses the threshold", async () => {
    await createRule({ threshold: 100 });
    await createMonitoringMetric({ metricType: "API_LATENCY", value: 300 });

    const result = await alertsService.evaluateAll();

    expect(result.fired).toBe(1);
    const events = await prisma.alertEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe(AlertStatus.FIRING);
  });

  /**
   * The whole point of the dedup. Without it a rule that stays over threshold
   * fires once per evaluation — once a minute, forever — and the feed is
   * useless within the hour.
   */
  it("does not fire again while the condition persists", async () => {
    await createRule({ threshold: 100 });
    await createMonitoringMetric({ metricType: "API_LATENCY", value: 300 });

    await alertsService.evaluateAll();
    await alertsService.evaluateAll();
    await alertsService.evaluateAll();

    expect(await prisma.alertEvent.count()).toBe(1);
  });

  it("resolves automatically when the metric recovers", async () => {
    const rule = await createRule({ threshold: 100 });
    await createMonitoringMetric({ metricType: "API_LATENCY", value: 300 });
    await alertsService.evaluateAll();

    // Replace the window's samples with healthy ones.
    await prisma.monitoringMetric.deleteMany();
    await createMonitoringMetric({ metricType: "API_LATENCY", value: 20 });

    const result = await alertsService.evaluateAll();

    expect(result.resolved).toBe(1);
    const event = await prisma.alertEvent.findFirstOrThrow({ where: { ruleId: rule.id } });
    expect(event.status).toBe(AlertStatus.RESOLVED);
    expect(event.resolvedAt).not.toBeNull();
  });

  it("can fire again after resolving", async () => {
    await createRule({ threshold: 100 });
    await createMonitoringMetric({ metricType: "API_LATENCY", value: 300 });
    await alertsService.evaluateAll();

    await prisma.monitoringMetric.deleteMany();
    await createMonitoringMetric({ metricType: "API_LATENCY", value: 20 });
    await alertsService.evaluateAll();

    await prisma.monitoringMetric.deleteMany();
    await createMonitoringMetric({ metricType: "API_LATENCY", value: 500 });
    await alertsService.evaluateAll();

    expect(await prisma.alertEvent.count()).toBe(2);
  });

  it("skips disabled rules", async () => {
    const rule = await createRule({ threshold: 100 });
    await alertsService.updateRule(rule.id, { isEnabled: false }, engineer.id);
    await createMonitoringMetric({ metricType: "API_LATENCY", value: 300 });

    const result = await alertsService.evaluateAll();

    expect(result.fired).toBe(0);
    expect(await prisma.alertEvent.count()).toBe(0);
  });

  /**
   * No samples means we know nothing, which is not the same as healthy. Firing
   * would be a false alarm; resolving would hide a real outage behind a dead
   * metrics pipeline.
   */
  it("neither fires nor resolves when the window has no samples", async () => {
    await createRule({ threshold: 100 });

    const result = await alertsService.evaluateAll();

    expect(result.fired).toBe(0);
    expect(result.resolved).toBe(0);
  });

  it("ignores samples outside the averaging window", async () => {
    await createRule({ threshold: 100, windowMinutes: 5 });
    await createMonitoringMetric({
      metricType: "API_LATENCY",
      value: 900,
      recordedAt: new Date(Date.now() - 60 * 60_000)
    });

    const result = await alertsService.evaluateAll();
    expect(result.fired).toBe(0);
  });

  it("averages rather than reacting to a single spike", async () => {
    await createRule({ threshold: 100 });
    await createMonitoringMetric({ metricType: "API_LATENCY", value: 400 });
    await createMonitoringMetric({ metricType: "API_LATENCY", value: 10 });
    await createMonitoringMetric({ metricType: "API_LATENCY", value: 10 });
    await createMonitoringMetric({ metricType: "API_LATENCY", value: 10 });

    // Mean is 107.5, still above 100.
    const result = await alertsService.evaluateAll();
    expect(result.fired).toBe(1);
  });
});

describe("alert acknowledgement", () => {
  it("removes an alert from the active set but keeps its history", async () => {
    await createRule({ threshold: 100 });
    await createMonitoringMetric({ metricType: "API_LATENCY", value: 300 });
    await alertsService.evaluateAll();

    const event = await prisma.alertEvent.findFirstOrThrow();

    const response = await request(app)
      .post(`/api/alerts/events/${event.id}/acknowledge`)
      .set(authHeaderFor(engineer));

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ACKNOWLEDGED");

    const firing = await request(app)
      .get("/api/alerts/events?status=FIRING")
      .set(authHeaderFor(engineer));
    expect(firing.body).toHaveLength(0);

    expect(await prisma.alertEvent.count()).toBe(1);
  });

  it("does not re-fire for a rule whose alert is merely acknowledged", async () => {
    await createRule({ threshold: 100 });
    await createMonitoringMetric({ metricType: "API_LATENCY", value: 300 });
    await alertsService.evaluateAll();

    const event = await prisma.alertEvent.findFirstOrThrow();
    await alertsService.acknowledge(event.id, engineer.id);

    // Still breaching — acknowledging means "I know", not "it stopped".
    await alertsService.evaluateAll();

    expect(await prisma.alertEvent.count()).toBe(1);
  });

  it("refuses to acknowledge an already-resolved alert", async () => {
    await createRule({ threshold: 100 });
    await createMonitoringMetric({ metricType: "API_LATENCY", value: 300 });
    await alertsService.evaluateAll();
    await prisma.monitoringMetric.deleteMany();
    await createMonitoringMetric({ metricType: "API_LATENCY", value: 10 });
    await alertsService.evaluateAll();

    const event = await prisma.alertEvent.findFirstOrThrow();
    const response = await request(app)
      .post(`/api/alerts/events/${event.id}/acknowledge`)
      .set(authHeaderFor(engineer));

    expect(response.status).toBe(400);
  });
});

describe("alert rule permissions", () => {
  it("lets an ops manager read alerts but not change rules", async () => {
    const ops = await createUser({ role: "OPS_MANAGER" });

    // OPS_MANAGER has neither monitoring:view nor alerts:manage.
    const read = await request(app).get("/api/alerts/rules").set(authHeaderFor(ops));
    expect(read.status).toBe(403);
  });

  it("lets an engineering admin manage rules", async () => {
    const response = await request(app)
      .post("/api/alerts/rules")
      .set(authHeaderFor(engineer))
      .send({
        name: "Error rate",
        metricType: "ERROR_RATE",
        comparator: "GREATER_THAN",
        threshold: 0.05
      });

    expect(response.status).toBe(201);
  });

  it("rejects an out-of-range window", async () => {
    const response = await request(app)
      .post("/api/alerts/rules")
      .set(authHeaderFor(engineer))
      .send({
        name: "Silly window",
        metricType: "ERROR_RATE",
        comparator: "GREATER_THAN",
        threshold: 1,
        windowMinutes: 100_000
      });

    expect(response.status).toBe(400);
  });
});
