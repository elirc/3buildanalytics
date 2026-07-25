import { prisma } from "../../db/prisma.js";
import { getPagination } from "../../shared/utils/pagination.js";
import { resolveSort, toPageCount } from "../../shared/utils/sorting.js";

/** Columns a caller may sort by. Anything else is a 400. */
export const AUDIT_SORT_COLUMNS = ["createdAt", "action", "entityType"] as const;

const ACTOR_SELECT = {
  select: {
    id: true,
    email: true,
    firstName: true,
    lastName: true,
    role: true
  }
} as const;

export const auditRepository = {
  async create(data: Parameters<typeof prisma.auditEvent.create>[0]["data"]) {
    return prisma.auditEvent.create({ data });
  },

  async list(filters: {
    startDate: Date;
    endDate: Date;
    action?: string;
    actorId?: string;
    entityType?: string;
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortDir?: string;
  }) {
    const pagination = getPagination(filters);
    const sort = resolveSort({
      sortBy: filters.sortBy,
      sortDir: filters.sortDir,
      allowed: AUDIT_SORT_COLUMNS,
      defaultColumn: "createdAt"
    });

    const where = {
      createdAt: {
        gte: filters.startDate,
        lte: filters.endDate
      },
      action: filters.action,
      actorId: filters.actorId,
      entityType: filters.entityType
    };

    const [items, total] = await Promise.all([
      prisma.auditEvent.findMany({
        where,
        include: { actor: ACTOR_SELECT },
        skip: pagination.skip,
        take: pagination.take,
        // See events.repository: the id tiebreak keeps paging stable when the
        // sort column has duplicates.
        orderBy: [{ [sort.column]: sort.direction }, { id: "asc" }]
      }),
      prisma.auditEvent.count({ where })
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
    return prisma.auditEvent.findUnique({
      where: { id },
      include: { actor: ACTOR_SELECT }
    });
  }
};
