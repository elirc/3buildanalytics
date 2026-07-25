import { z } from "zod";

const METRIC_TYPES = [
  "API_LATENCY",
  "ERROR_RATE",
  "JOB_FAILURE_RATE",
  "QUEUE_DEPTH",
  "DB_QUERY_TIME",
  "CACHE_HIT_RATE"
] as const;

export const createAlertRuleSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(120),
    metricType: z.enum(METRIC_TYPES),
    comparator: z.enum(["GREATER_THAN", "LESS_THAN"]),
    threshold: z.number().finite(),
    // Capped at a day: a longer window smooths away the incident you are
    // trying to detect. Minimum of one so a rule cannot divide by nothing.
    windowMinutes: z.number().int().min(1).max(1440).optional()
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

export const updateAlertRuleSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      threshold: z.number().finite().optional(),
      windowMinutes: z.number().int().min(1).max(1440).optional(),
      isEnabled: z.boolean().optional()
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: "Provide at least one field to update"
    }),
  params: z.object({ id: z.string().min(1) }),
  query: z.object({}).optional()
});

export const alertRuleIdSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ id: z.string().min(1) }),
  query: z.object({}).optional()
});

export const listAlertEventsSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z.object({
    status: z.enum(["FIRING", "ACKNOWLEDGED", "RESOLVED"]).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional()
  })
});
