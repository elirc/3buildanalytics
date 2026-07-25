import { z } from "zod";

import { WIDGET_IDS } from "./widgets.js";

const ROLES = [
  "SYSTEM_ADMIN",
  "OPS_MANAGER",
  "PRODUCT_MANAGER",
  "ENGINEERING_ADMIN",
  "AUDIT_VIEWER",
  "EXECUTIVE_VIEWER",
  "READ_ONLY"
] as const;

/**
 * The layout contract.
 *
 * layoutJson was `z.record(z.unknown())` — any JSON at all. While nothing
 * rendered from it that was harmless; now that it drives the dashboard, a
 * config naming a widget that does not exist would produce a blank card with no
 * explanation. Unknown ids are refused at write time, where the author can
 * still do something about it.
 */
const layoutSchema = z
  .object({
    widgets: z
      .array(
        z.object({
          id: z.enum(WIDGET_IDS as [string, ...string[]]),
          size: z.enum(["half", "full"]).default("full")
        })
      )
      .max(20)
  })
  .strict();

export const createDashboardConfigSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    role: z.enum(ROLES),
    layoutJson: layoutSchema,
    isDefault: z.boolean().optional()
  }),
  query: z.object({}).optional(),
  params: z.object({}).optional()
});

export const updateDashboardConfigSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    role: z.enum(ROLES).optional(),
    layoutJson: layoutSchema.optional(),
    isDefault: z.boolean().optional()
  }),
  query: z.object({}).optional(),
  params: z.object({
    id: z.string().min(1)
  })
});

export const defaultConfigSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z.object({ role: z.enum(ROLES).optional() })
});

export type DashboardLayout = z.infer<typeof layoutSchema>;
