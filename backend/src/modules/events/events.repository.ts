import { Prisma, type EventType } from "@prisma/client";

import { prisma } from "../../db/prisma.js";
import { getPagination } from "../../shared/utils/pagination.js";
import { resolveSort, toPageCount } from "../../shared/utils/sorting.js";

/**
 * Columns a caller may sort by. Anything else is a 400.
 *
 * Note that eventType is a Postgres ENUM, so it sorts by declaration order in
 * schema.prisma rather than alphabetically. That keeps the column's index
 * usable — alphabetical would mean casting every row to text — but it is not
 * what "A-Z" suggests, so surface it in the UI as "group by type" if that
 * distinction ever matters to users.
 */
export const EVENT_SORT_COLUMNS = ["occurredAt", "eventType", "actorEmail"] as const;
export type EventSortColumn = (typeof EVENT_SORT_COLUMNS)[number];

interface EventFilters {
  startDate: Date;
  endDate: Date;
  eventType?: string;
  actorId?: string;
  entityType?: string;
  entityId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: string;
}

export const eventsRepository = {
  async create(data: Prisma.TrackedEventCreateInput) {
    return prisma.trackedEvent.create({ data });
  },

  async findMany(filters: EventFilters) {
    const pagination = getPagination(filters);
    const sort = resolveSort({
      sortBy: filters.sortBy,
      sortDir: filters.sortDir,
      allowed: EVENT_SORT_COLUMNS,
      defaultColumn: "occurredAt"
    });

    const where: Prisma.TrackedEventWhereInput = {
      occurredAt: {
        gte: filters.startDate,
        lte: filters.endDate
      },
      eventType: filters.eventType as EventType | undefined,
      actorId: filters.actorId,
      entityType: filters.entityType,
      entityId: filters.entityId,
      OR: filters.search
        ? [
            { actorEmail: { contains: filters.search, mode: "insensitive" } },
            { entityType: { contains: filters.search, mode: "insensitive" } }
          ]
        : undefined
    };

    const [items, total] = await Promise.all([
      prisma.trackedEvent.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        // Secondary sort on id keeps paging stable. Without it, rows sharing a
        // sort value can be returned in a different order on each query, so the
        // same row appears on two pages while another is never shown at all.
        orderBy: [{ [sort.column]: sort.direction }, { id: "asc" }]
      }),
      prisma.trackedEvent.count({ where })
    ]);

    return {
      items,
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
      pageCount: toPageCount(total, pagination.pageSize),
      sortBy: sort.column,
      sortDir: sort.direction
    };
  },

  async findById(id: string) {
    return prisma.trackedEvent.findUnique({ where: { id } });
  }
};
