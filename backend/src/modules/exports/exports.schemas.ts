import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

/**
 * Every export type declares its own filters.
 *
 * This replaces `filters: z.record(z.unknown())`, which accepted anything. That
 * mattered more than it looks: buildDateFilter returned `{}` when startDate was
 * missing or misspelled, so a typo in a filter key silently exported the entire
 * table (capped at 25,000 rows) instead of the week the user asked for.
 *
 * .strict() on each branch turns that typo into a 400 naming the offending key.
 * The discriminated union means the error also tells you which fields the
 * chosen export type actually supports.
 */
const dateWindow = {
  startDate: isoDate,
  endDate: isoDate
};

const trackedEventFilters = z
  .object({
    ...dateWindow,
    eventType: z.string().optional(),
    actorId: z.string().optional(),
    entityType: z.string().optional(),
    search: z.string().optional()
  })
  .strict();

const auditEventFilters = z
  .object({
    ...dateWindow,
    action: z.string().optional(),
    actorId: z.string().optional(),
    entityType: z.string().optional()
  })
  .strict();

const monitoringMetricFilters = z
  .object({
    ...dateWindow,
    metricType: z
      .enum([
        "API_LATENCY",
        "ERROR_RATE",
        "JOB_FAILURE_RATE",
        "QUEUE_DEPTH",
        "DB_QUERY_TIME",
        "CACHE_HIT_RATE"
      ])
      .optional()
  })
  .strict();

const kpiSummaryFilters = z.object({ ...dateWindow }).strict();

export const createExportSchema = z.object({
  body: z.discriminatedUnion("exportType", [
    z.object({ exportType: z.literal("TRACKED_EVENTS"), filters: trackedEventFilters }),
    z.object({ exportType: z.literal("AUDIT_EVENTS"), filters: auditEventFilters }),
    z.object({ exportType: z.literal("MONITORING_METRICS"), filters: monitoringMetricFilters }),
    z.object({ exportType: z.literal("KPI_SUMMARY"), filters: kpiSummaryFilters })
  ]),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

export const estimateExportSchema = createExportSchema;

export const exportIdSchema = z.object({
  body: z.object({}).optional(),
  query: z.object({}).optional(),
  params: z.object({
    id: z.string().min(1)
  })
});

export type ExportFilters =
  | z.infer<typeof trackedEventFilters>
  | z.infer<typeof auditEventFilters>
  | z.infer<typeof monitoringMetricFilters>
  | z.infer<typeof kpiSummaryFilters>;
