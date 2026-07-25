import { promises as fs } from "node:fs";
import path from "node:path";

import { Prisma } from "@prisma/client";
import { ExportStatus, type ExportType } from "@prisma/client";

import { env } from "../../config/env.js";
import { getExportQueue } from "../../jobs/queue.js";
import { prisma } from "../../db/prisma.js";
import { AppError } from "../../shared/errors/AppError.js";
import { ERROR_CODES } from "../../shared/errors/errorCodes.js";
import { logWarn } from "../../shared/utils/logger.js";
import { parseDateRange } from "../../shared/utils/dates.js";
import { dashboardService } from "../dashboard/dashboard.service.js";
import { auditService } from "../audit/audit.service.js";
import { exportsRepository } from "./exports.repository.js";
import { csvService } from "./csv.service.js";

const MAX_SYNC_EXPORT_ROWS = 10_000;
const MAX_RETRIES = 3;

export const exportsService = {
  async create(input: {
    requestedById: string;
    requestedByRole: Express.User["role"];
    exportType: ExportType;
    filters?: Record<string, unknown>;
  }) {
    // Estimate BEFORE inserting the row. buildDateFilter now throws on an
    // invalid window, and doing this second would leave an orphaned PENDING job
    // behind every rejected request — rows that nothing will ever process and
    // that inflate the queue-depth metric.
    const estimatedRowCount = await estimateExportRows(input.exportType, input.filters);

    const job = await exportsRepository.create({
      requestedById: input.requestedById,
      exportType: input.exportType,
      filtersJson: input.filters as Prisma.InputJsonValue | undefined,
      status: ExportStatus.PENDING
    });

    await auditService.record({
      actorId: input.requestedById,
      action: "EXPORT_REQUESTED",
      entityType: "ExportJob",
      entityId: job.id,
      metadata: {
        exportType: input.exportType,
        filters: input.filters
      }
    });

    return dispatchJob(job.id, {
      exportType: input.exportType,
      filters: input.filters,
      requestedById: input.requestedById,
      requestedByRole: input.requestedByRole,
      knownRowCount: estimatedRowCount
    });
  },

  /** Row count a set of filters would produce, without creating a job. */
  async estimate(exportType: ExportType, filters?: Record<string, unknown>) {
    const rowCount = await estimateExportRows(exportType, filters);
    return { rowCount, willQueue: rowCount > MAX_SYNC_EXPORT_ROWS, maxSyncRows: MAX_SYNC_EXPORT_ROWS };
  },

  async listForUser(userId: string) {
    return exportsRepository.listByUser(userId);
  },

  async getById(userId: string, id: string) {
    const job = await exportsRepository.findById(id);

    if (!job || job.requestedById !== userId) {
      throw new AppError(ERROR_CODES.NOT_FOUND, "Export job not found", 404);
    }

    return job;
  },

  async downloadForUser(userId: string, id: string) {
    const job = await this.getById(userId, id);

    if (job.status !== ExportStatus.COMPLETED || !job.fileUrl || !job.fileName) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Export is not ready for download", 400);
    }

    return {
      fileName: job.fileName,
      filePath: resolveExportFilePath(job.fileName)
    };
  },

  /**
   * Retries a failed export, reusing the same row.
   *
   * The previous implementation reset this job to PENDING and then called
   * create(), which inserted a *second* job. The original stayed PENDING
   * forever because nothing would ever pick it up, so every retry leaked one
   * permanently-pending row — and since queue depth is counted from PENDING
   * rows, the engineering dashboard's backlog climbed on every retry and never
   * came down.
   */
  async retry(userId: string, id: string, userRole: Express.User["role"]) {
    const job = await this.getById(userId, id);

    if (job.status !== ExportStatus.FAILED) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "Only failed exports can be retried", 400);
    }

    if (job.retryCount >= MAX_RETRIES) {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        `This export has already been retried ${MAX_RETRIES} times. Create a new one instead.`,
        400
      );
    }

    await exportsRepository.update(job.id, {
      status: ExportStatus.PENDING,
      errorMessage: null,
      completedAt: null,
      fileName: null,
      fileUrl: null,
      retryCount: job.retryCount + 1
    });

    // Same id, not a new job. Dispatch makes the same sync-or-queue decision
    // create() does, so a small retry completes immediately instead of waiting
    // on a queue that may not be reachable.
    return dispatchJob(job.id, {
      exportType: job.exportType,
      filters: (job.filtersJson as Record<string, unknown> | null) ?? undefined,
      requestedById: userId,
      requestedByRole: userRole
    });
  },

  async processJob(
    exportJobId: string,
    context?: { requestedById?: string; requestedByRole?: Express.User["role"] }
  ) {
    const job = await exportsRepository.findById(exportJobId);

    if (!job) {
      throw new AppError(ERROR_CODES.NOT_FOUND, "Export job not found", 404);
    }

    /**
     * Claim the job with a conditional update.
     *
     * BullMQ retries on failure and can redeliver, and the sync path can race
     * a worker that picked the same job up. Without a claim the same export is
     * processed twice: two CSVs written, two CSV_EXPORTED tracked events, two
     * EXPORT_COMPLETED audit rows for one user action.
     *
     * Only PENDING or FAILED can be claimed, and the update is atomic — if it
     * touches zero rows someone else already has it, so we return their result
     * rather than duplicating the work.
     */
    const claimed = await prisma.exportJob.updateMany({
      where: {
        id: job.id,
        status: { in: [ExportStatus.PENDING, ExportStatus.FAILED] }
      },
      data: { status: ExportStatus.PROCESSING, errorMessage: null }
    });

    if (claimed.count === 0) {
      logWarn("export.job.already_claimed", { exportJobId: job.id, status: job.status });
      return exportsRepository.findById(job.id);
    }

    try {
      const requestContext = await resolveRequestContext(job.requestedById, context?.requestedByRole);
      const rows = await buildExportRows(job.exportType, job.filtersJson, requestContext.role);
      const csv = csvService.buildDownloadableCsv(rows);
      const fileName = csvService.buildFileName(job.exportType.toLowerCase());

      await fs.mkdir(resolveExportStorageDir(), { recursive: true });
      await fs.writeFile(resolveExportFilePath(fileName), csv, "utf8");

      const completedJob = await exportsRepository.update(job.id, {
        status: ExportStatus.COMPLETED,
        rowCount: rows.length,
        fileName,
        fileUrl: `${env.API_BASE_URL}/api/exports/${job.id}/download`,
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      });

      await prisma.trackedEvent.create({
        data: {
          eventType: "CSV_EXPORTED",
          actorId: requestContext.userId,
          actorEmail: requestContext.email,
          entityType: "ExportJob",
          entityId: job.id,
          metadata: {
            exportType: job.exportType,
            rowCount: rows.length
          }
        }
      });

      await auditService.record({
        actorId: requestContext.userId,
        action: "EXPORT_COMPLETED",
        entityType: "ExportJob",
        entityId: job.id,
        metadata: {
          exportType: job.exportType,
          rowCount: rows.length
        }
      });

      return completedJob;
    } catch (error) {
      await exportsRepository.update(job.id, {
        status: ExportStatus.FAILED,
        errorMessage: error instanceof Error ? error.message : "Unknown export failure"
      });

      await prisma.trackedEvent.create({
        data: {
          eventType: "BACKGROUND_JOB_FAILED",
          entityType: "ExportJob",
          entityId: job.id,
          metadata: {
            error: error instanceof Error ? error.message : "Unknown export failure"
          }
        }
      });

      await auditService.record({
        actorId: context?.requestedById ?? job.requestedById,
        action: "EXPORT_FAILED",
        entityType: "ExportJob",
        entityId: job.id,
        metadata: {
          error: error instanceof Error ? error.message : "Unknown export failure"
        }
      });

      throw error;
    }
  }
};

/**
 * Decides how an export runs and starts it.
 *
 * Small exports run inline so the user gets an immediate download; large ones
 * go on the queue. If the queue cannot be reached we process inline anyway and
 * log it — degraded, not broken, which is the same posture server.ts takes when
 * Redis is missing at boot.
 *
 * Shared by create() and retry() so the two cannot drift. retry() previously
 * had no such logic at all: it delegated to create(), which is what produced
 * the duplicate-job bug.
 */
async function dispatchJob(
  jobId: string,
  context: {
    exportType: ExportType;
    filters?: Record<string, unknown>;
    requestedById: string;
    requestedByRole: Express.User["role"];
    knownRowCount?: number;
  }
) {
  const rowCount =
    context.knownRowCount ?? (await estimateExportRows(context.exportType, context.filters));

  if (rowCount <= MAX_SYNC_EXPORT_ROWS) {
    return exportsService.processJob(jobId, {
      requestedById: context.requestedById,
      requestedByRole: context.requestedByRole
    });
  }

  try {
    await getExportQueue().add("PROCESS_EXPORT", {
      exportJobId: jobId,
      requestedById: context.requestedById,
      requestedByRole: context.requestedByRole
    });
    return exportsRepository.findById(jobId);
  } catch (error) {
    logWarn("export.queue.unavailable.falling_back", {
      exportJobId: jobId,
      error: error instanceof Error ? error.message : "unknown"
    });
    return exportsService.processJob(jobId, {
      requestedById: context.requestedById,
      requestedByRole: context.requestedByRole
    });
  }
}

/**
 * Counts what an export would produce.
 *
 * Only the relevant where-clause is built now. The previous version built all
 * three regardless of type, which was harmless when they returned `{}` and is
 * actively wrong now that a missing date throws — an audit export would have
 * blown up validating a tracked-event clause it never used.
 */
export async function estimateExportRows(
  exportType: ExportType,
  filters?: Record<string, unknown>
) {
  const safeFilters = filters ?? {};

  switch (exportType) {
    case "TRACKED_EVENTS":
      return prisma.trackedEvent.count({ where: buildTrackedEventWhere(safeFilters) });
    case "AUDIT_EVENTS":
      return prisma.auditEvent.count({ where: buildAuditEventWhere(safeFilters) });
    case "MONITORING_METRICS":
      return prisma.monitoringMetric.count({ where: buildMonitoringMetricWhere(safeFilters) });
    case "KPI_SUMMARY":
      // One row by definition — but still validate the window so a bad range is
      // refused here rather than surfacing later inside the job.
      buildDateFilter(safeFilters, "occurredAt");
      return 1;
    default:
      return 0;
  }
}

async function buildExportRows(
  exportType: ExportType,
  filtersJson: Prisma.JsonValue | null,
  role: Express.User["role"]
) {
  const filters = (filtersJson as Record<string, unknown> | null) ?? {};

  switch (exportType) {
    case "TRACKED_EVENTS": {
      const items = await prisma.trackedEvent.findMany({
        // Now applies eventType/actorId/entityType/search, which the schema
        // accepted and this function previously ignored.
        where: buildTrackedEventWhere(filters),
        orderBy: { occurredAt: "desc" },
        take: 25_000
      });

      return items.map((item) => ({
        id: item.id,
        eventType: item.eventType,
        actorEmail: item.actorEmail,
        entityType: item.entityType,
        entityId: item.entityId,
        occurredAt: item.occurredAt.toISOString()
      }));
    }

    case "AUDIT_EVENTS": {
      const items = await prisma.auditEvent.findMany({
        where: buildAuditEventWhere(filters),
        include: {
          actor: {
            select: {
              email: true
            }
          }
        },
        orderBy: { createdAt: "desc" },
        take: 25_000
      });

      return items.map((item) => ({
        id: item.id,
        action: item.action,
        actorEmail: item.actor?.email,
        entityType: item.entityType,
        entityId: item.entityId,
        createdAt: item.createdAt.toISOString()
      }));
    }

    case "MONITORING_METRICS": {
      const items = await prisma.monitoringMetric.findMany({
        where: buildMonitoringMetricWhere(filters),
        orderBy: { recordedAt: "desc" },
        take: 25_000
      });

      return items.map((item) => ({
        id: item.id,
        metricType: item.metricType,
        name: item.name,
        value: item.value,
        unit: item.unit,
        recordedAt: item.recordedAt.toISOString()
      }));
    }

    case "KPI_SUMMARY": {
      const startDate = String(filters.startDate ?? new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10));
      const endDate = String(filters.endDate ?? new Date().toISOString().slice(0, 10));
      const summary = await dashboardService.getKpiSummary({
        role,
        startDate,
        endDate
      });

      return [
        {
          startDate,
          endDate,
          ...summary
        }
      ];
    }

    default:
      return [];
  }
}

/**
 * Builds the date clause for an export.
 *
 * Previously this returned `{}` when either date was missing or unparseable,
 * which meant an unfiltered query: a typo in a filter key silently exported the
 * entire table (capped at 25,000 rows) rather than the week that was asked for.
 * Exports are the one place where quietly returning *more* data than requested
 * is the worst possible failure mode, so it now throws.
 *
 * parseDateRange also gives us the inclusive end-of-day handling from US-02,
 * so an export ending "today" contains today.
 */
function buildDateFilter(
  filters: Record<string, unknown> | undefined,
  field: "occurredAt" | "createdAt" | "recordedAt"
) {
  const safeFilters = filters ?? {};
  const { startDate, endDate } = safeFilters;

  if (typeof startDate !== "string" || typeof endDate !== "string") {
    throw new AppError(
      ERROR_CODES.BAD_REQUEST,
      "Exports require both startDate and endDate",
      400
    );
  }

  const range = parseDateRange(startDate, endDate, { maxRangeDays: 365 });

  return {
    [field]: {
      gte: range.startDate,
      lte: range.endDate
    }
  };
}

/** Non-date filters, applied per export type. */
function buildTrackedEventWhere(filters: Record<string, unknown>) {
  return {
    ...buildDateFilter(filters, "occurredAt"),
    eventType: typeof filters.eventType === "string" ? (filters.eventType as never) : undefined,
    actorId: typeof filters.actorId === "string" ? filters.actorId : undefined,
    entityType: typeof filters.entityType === "string" ? filters.entityType : undefined,
    OR:
      typeof filters.search === "string" && filters.search !== ""
        ? [
            { actorEmail: { contains: filters.search, mode: "insensitive" as const } },
            { entityType: { contains: filters.search, mode: "insensitive" as const } }
          ]
        : undefined
  };
}

function buildAuditEventWhere(filters: Record<string, unknown>) {
  return {
    ...buildDateFilter(filters, "createdAt"),
    action: typeof filters.action === "string" ? filters.action : undefined,
    actorId: typeof filters.actorId === "string" ? filters.actorId : undefined,
    entityType: typeof filters.entityType === "string" ? filters.entityType : undefined
  };
}

function buildMonitoringMetricWhere(filters: Record<string, unknown>) {
  return {
    ...buildDateFilter(filters, "recordedAt"),
    metricType: typeof filters.metricType === "string" ? (filters.metricType as never) : undefined
  };
}

async function resolveRequestContext(userId: string, role?: Express.User["role"]) {
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });

  if (!user) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "Export requester not found", 404);
  }

  return {
    userId: user.id,
    email: user.email,
    role: role ?? user.role
  };
}

function resolveExportStorageDir() {
  return path.resolve(process.cwd(), env.EXPORT_STORAGE_DIR);
}

function resolveExportFilePath(fileName: string) {
  return path.join(resolveExportStorageDir(), fileName);
}
