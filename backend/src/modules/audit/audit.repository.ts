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
  },

  /**
   * The three summaries below replace "fetch 10,000 rows and reduce in Node".
   *
   * Each endpoint did that independently, so viewing the audit dashboard pulled
   * 30,000 rows across the wire and deserialised them through Prisma to produce
   * three small arrays. The database can group; it is what it is for.
   */
  async summaryByAction(startDate: Date, endDate: Date) {
    const rows = await prisma.auditEvent.groupBy({
      by: ["action"],
      where: { createdAt: { gte: startDate, lte: endDate } },
      _count: { _all: true },
      orderBy: { action: "asc" }
    });

    return rows.map((row) => ({ action: row.action, count: row._count._all }));
  },

  /**
   * Top actors by volume.
   *
   * Limited to 20: the previous version returned every actor, and a bar chart
   * with hundreds of bars communicates nothing. A COALESCE keeps events with no
   * actor visible as "unknown" rather than dropping them, which matters in an
   * audit context — anonymous activity is exactly what someone is looking for.
   */
  async summaryByActor(startDate: Date, endDate: Date, limit = 20) {
    const rows = await prisma.$queryRaw<Array<{ actor: string; count: bigint }>>`
      SELECT COALESCE(u."email", 'unknown') AS actor, COUNT(*)::bigint AS count
      FROM "AuditEvent" a
      LEFT JOIN "User" u ON u."id" = a."actorId"
      WHERE a."createdAt" >= ${startDate}
        AND a."createdAt" <= ${endDate}
      GROUP BY actor
      ORDER BY count DESC, actor ASC
      LIMIT ${limit}
    `;

    return rows.map((row) => ({ actor: row.actor, count: Number(row.count) }));
  },

  async summaryOverTime(startDate: Date, endDate: Date) {
    const rows = await prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
      SELECT date_trunc('day', a."createdAt") AS bucket, COUNT(*)::bigint AS count
      FROM "AuditEvent" a
      WHERE a."createdAt" >= ${startDate}
        AND a."createdAt" <= ${endDate}
      GROUP BY bucket
      ORDER BY bucket ASC
    `;

    return rows.map((row) => ({
      date: row.bucket.toISOString().slice(0, 10),
      count: Number(row.count)
    }));
  }
};
