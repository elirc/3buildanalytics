import { Prisma } from "@prisma/client";

import { AppError } from "../../shared/errors/AppError.js";
import { ERROR_CODES } from "../../shared/errors/errorCodes.js";
import { parseDateRange } from "../../shared/utils/dates.js";
import { cacheInvalidator } from "../../cache/cacheInvalidator.js";
import { auditRepository } from "./audit.repository.js";

export const auditService = {
  async record(input: {
    actorId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const event = await auditRepository.create({
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent
    });

    await cacheInvalidator.onAuditEvent();

    return event;
  },

  async list(input: {
    startDate: string;
    endDate: string;
    action?: string;
    actorId?: string;
    entityType?: string;
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortDir?: string;
  }) {
    const range = parseDateRange(input.startDate, input.endDate);
    return auditRepository.list({ ...input, ...range });
  },

  async getById(id: string) {
    const item = await auditRepository.findById(id);

    if (!item) {
      throw new AppError(ERROR_CODES.NOT_FOUND, "Audit event not found", 404);
    }

    return item;
  },

  async summaryByAction(input: { startDate: string; endDate: string }) {
    const range = parseDateRange(input.startDate, input.endDate);
    return auditRepository.summaryByAction(range.startDate, range.endDate);
  },

  async summaryByActor(input: { startDate: string; endDate: string }) {
    const range = parseDateRange(input.startDate, input.endDate);
    return auditRepository.summaryByActor(range.startDate, range.endDate);
  },

  async summaryOverTime(input: { startDate: string; endDate: string }) {
    const range = parseDateRange(input.startDate, input.endDate);
    return auditRepository.summaryOverTime(range.startDate, range.endDate);
  }
};
