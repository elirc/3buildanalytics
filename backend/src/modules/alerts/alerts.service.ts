import { AlertStatus, type AlertComparator, type MonitoringMetricType } from "@prisma/client";

import { prisma } from "../../db/prisma.js";
import { AppError } from "../../shared/errors/AppError.js";
import { ERROR_CODES } from "../../shared/errors/errorCodes.js";
import { logInfo } from "../../shared/utils/logger.js";
import { auditService } from "../audit/audit.service.js";

export const alertsService = {
  async listRules() {
    return prisma.alertRule.findMany({ orderBy: [{ isEnabled: "desc" }, { name: "asc" }] });
  },

  async createRule(input: {
    name: string;
    metricType: MonitoringMetricType;
    comparator: AlertComparator;
    threshold: number;
    windowMinutes?: number;
    createdById: string;
  }) {
    const rule = await prisma.alertRule.create({
      data: {
        name: input.name,
        metricType: input.metricType,
        comparator: input.comparator,
        threshold: input.threshold,
        windowMinutes: input.windowMinutes ?? 15,
        createdById: input.createdById
      }
    });

    await auditService.record({
      actorId: input.createdById,
      action: "ALERT_RULE_CREATED",
      entityType: "AlertRule",
      entityId: rule.id,
      metadata: { name: rule.name, metricType: rule.metricType, threshold: rule.threshold }
    });

    return rule;
  },

  async updateRule(
    id: string,
    input: { name?: string; threshold?: number; windowMinutes?: number; isEnabled?: boolean },
    actorId: string
  ) {
    const existing = await prisma.alertRule.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(ERROR_CODES.NOT_FOUND, "Alert rule not found", 404);
    }

    const rule = await prisma.alertRule.update({ where: { id }, data: input });

    await auditService.record({
      actorId,
      action: "ALERT_RULE_UPDATED",
      entityType: "AlertRule",
      entityId: id,
      metadata: { changes: input }
    });

    return rule;
  },

  async deleteRule(id: string, actorId: string) {
    const existing = await prisma.alertRule.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(ERROR_CODES.NOT_FOUND, "Alert rule not found", 404);
    }

    // Cascade removes its events too: an alert history for a rule nobody can
    // look up is noise.
    await prisma.alertRule.delete({ where: { id } });

    await auditService.record({
      actorId,
      action: "ALERT_RULE_DELETED",
      entityType: "AlertRule",
      entityId: id,
      metadata: { name: existing.name }
    });
  },

  async listEvents(input?: { status?: AlertStatus; limit?: number }) {
    return prisma.alertEvent.findMany({
      where: input?.status ? { status: input.status } : undefined,
      include: { rule: true },
      // Firing first, then most recent — the feed should open on what is wrong
      // now, not on what was wrong longest ago.
      orderBy: [{ status: "asc" }, { firedAt: "desc" }],
      take: input?.limit ?? 50
    });
  },

  async acknowledge(id: string, actorId: string) {
    const event = await prisma.alertEvent.findUnique({ where: { id } });

    if (!event) {
      throw new AppError(ERROR_CODES.NOT_FOUND, "Alert not found", 404);
    }

    if (event.status !== AlertStatus.FIRING) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Only a firing alert can be acknowledged", 400);
    }

    const acknowledged = await prisma.alertEvent.update({
      where: { id },
      data: { status: AlertStatus.ACKNOWLEDGED, acknowledgedById: actorId }
    });

    await auditService.record({
      actorId,
      action: "ALERT_ACKNOWLEDGED",
      entityType: "AlertEvent",
      entityId: id,
      metadata: { ruleId: event.ruleId, observedValue: event.observedValue }
    });

    return acknowledged;
  },

  /**
   * Evaluates every enabled rule once.
   *
   * The deduplication is the whole design. Without it a rule that stays over
   * threshold fires once per evaluation — once a minute, forever — and the feed
   * becomes unusable within an hour. An alert represents a *condition*, not an
   * observation, so at most one open event exists per rule at a time.
   *
   * Recovery resolves the open event rather than requiring a human to close it,
   * because an alert nobody has to tidy up is an alert people keep trusting.
   */
  async evaluateAll(now = new Date()) {
    const rules = await prisma.alertRule.findMany({ where: { isEnabled: true } });

    let fired = 0;
    let resolved = 0;

    for (const rule of rules) {
      const since = new Date(now.getTime() - rule.windowMinutes * 60_000);

      const aggregate = await prisma.monitoringMetric.aggregate({
        where: { metricType: rule.metricType, recordedAt: { gte: since, lte: now } },
        _avg: { value: true }
      });

      const observed = aggregate._avg.value;

      // No samples in the window means we know nothing — which is not the same
      // as "healthy". Neither firing nor resolving is correct here.
      if (observed === null) {
        continue;
      }

      const breached =
        rule.comparator === "GREATER_THAN" ? observed > rule.threshold : observed < rule.threshold;

      const open = await prisma.alertEvent.findFirst({
        where: { ruleId: rule.id, status: { in: [AlertStatus.FIRING, AlertStatus.ACKNOWLEDGED] } }
      });

      if (breached && !open) {
        const event = await prisma.alertEvent.create({
          data: { ruleId: rule.id, observedValue: observed, status: AlertStatus.FIRING }
        });
        fired += 1;

        await auditService.record({
          action: "ALERT_FIRED",
          entityType: "AlertEvent",
          entityId: event.id,
          metadata: { ruleId: rule.id, ruleName: rule.name, observedValue: observed }
        });
      } else if (!breached && open) {
        await prisma.alertEvent.update({
          where: { id: open.id },
          data: { status: AlertStatus.RESOLVED, resolvedAt: now }
        });
        resolved += 1;

        await auditService.record({
          action: "ALERT_RESOLVED",
          entityType: "AlertEvent",
          entityId: open.id,
          metadata: { ruleId: rule.id, ruleName: rule.name, observedValue: observed }
        });
      }
    }

    if (fired > 0 || resolved > 0) {
      logInfo("alerts.evaluated", { rules: rules.length, fired, resolved });
    }

    return { evaluated: rules.length, fired, resolved };
  }
};
