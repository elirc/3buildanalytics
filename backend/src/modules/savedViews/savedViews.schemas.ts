import { z } from "zod";

/**
 * Pages a view can belong to. An allowlist rather than a free string, so a typo
 * cannot create a view that is invisible everywhere.
 */
export const SAVED_VIEW_PAGES = [
  "operations",
  "product",
  "engineering",
  "executive",
  "events",
  "audit"
] as const;

/**
 * The filter payload mirrors what useDashboardFilters puts in the URL.
 *
 * .strict() matters here: the object is stored as JSON and replayed into the
 * query string later, so silently accepting unknown keys would let a client
 * stash arbitrary data in the database and have it echoed back to other users
 * of a shared view.
 */
const filtersSchema = z
  .object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    interval: z.enum(["day", "week"]).optional(),
    eventType: z.string().optional(),
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().positive().max(100).optional(),
    sortBy: z.string().optional(),
    sortDir: z.enum(["asc", "desc"]).optional()
  })
  .strict();

export const listSavedViewsSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z.object({
    page: z.enum(SAVED_VIEW_PAGES).optional()
  })
});

export const createSavedViewSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(80),
    page: z.enum(SAVED_VIEW_PAGES),
    filtersJson: filtersSchema,
    isShared: z.boolean().optional()
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

export const updateSavedViewSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(80).optional(),
    filtersJson: filtersSchema.optional(),
    isShared: z.boolean().optional()
  }),
  params: z.object({ id: z.string().min(1) }),
  query: z.object({}).optional()
});

export const savedViewIdSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ id: z.string().min(1) }),
  query: z.object({}).optional()
});
