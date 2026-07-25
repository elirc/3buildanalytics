import type { Prisma } from "@prisma/client";

import { AppError } from "../../shared/errors/AppError.js";
import { ERROR_CODES } from "../../shared/errors/errorCodes.js";
import { parseDateRange } from "../../shared/utils/dates.js";
import { dashboardRepository } from "../dashboard/dashboard.repository.js";
import { cacheInvalidator } from "../../cache/cacheInvalidator.js";
import { eventsRepository } from "./events.repository.js";

export const eventsService = {
  async track(data: Prisma.TrackedEventCreateInput) {
    const event = await eventsRepository.create(data);

    // After the write, and never allowed to fail it: the TTL is still a
    // backstop, so a cache that cannot be cleared is a staleness problem, not a
    // reason to reject the caller's event.
    await cacheInvalidator.onTrackedEvent();

    return event;
  },

  async list(filters: {
    startDate: string;
    endDate: string;
    eventType?: string;
    actorId?: string;
    entityType?: string;
    entityId?: string;
    search?: string;
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortDir?: string;
  }) {
    const range = parseDateRange(filters.startDate, filters.endDate);
    return eventsRepository.findMany({ ...filters, ...range });
  },

  async getById(id: string) {
    const event = await eventsRepository.findById(id);

    if (!event) {
      throw new AppError(ERROR_CODES.NOT_FOUND, "Tracked event not found", 404);
    }

    return event;
  },

  /**
   * Was 22 queries to produce 11 integers: a loop over every EventType, each
   * iteration calling findMany — which itself runs a findMany *and* a count —
   * and discarding the 25 fetched rows.
   *
   * Now one GROUP BY. includeZeroes preserves this endpoint's contract of
   * returning every type, so a chart shows the full vocabulary rather than only
   * what happened to occur.
   */
  async getSummaryByType(filters: { startDate: string; endDate: string }) {
    const { startDate, endDate } = parseDateRange(filters.startDate, filters.endDate);
    return dashboardRepository.getEventsByType(startDate, endDate, { includeZeroes: true });
  },

  /**
   * Was: fetch up to 10,000 rows into Node and group them with reduce. Now the
   * database buckets them and returns one row per day.
   */
  async getSummaryOverTime(filters: { startDate: string; endDate: string }) {
    const { startDate, endDate } = parseDateRange(filters.startDate, filters.endDate);
    return dashboardRepository.getEventsOverTime(startDate, endDate, "day");
  }
};
