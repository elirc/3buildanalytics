import { z } from "zod";

const ROLES = [
  "SYSTEM_ADMIN",
  "OPS_MANAGER",
  "PRODUCT_MANAGER",
  "ENGINEERING_ADMIN",
  "AUDIT_VIEWER",
  "EXECUTIVE_VIEWER",
  "READ_ONLY"
] as const;

export const USER_SORT_COLUMNS = ["createdAt", "email", "role", "lastName"] as const;

export const listUsersSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z.object({
    page: z.coerce.number().optional(),
    pageSize: z.coerce.number().optional(),
    search: z.string().optional(),
    role: z.enum(ROLES).optional(),
    // Query strings are text, so "false" would be truthy as a plain boolean.
    isActive: z.enum(["true", "false"]).optional(),
    sortBy: z.string().optional(),
    sortDir: z.enum(["asc", "desc"]).optional()
  })
});

export const createUserSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8),
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().min(1),
    role: z.enum(ROLES)
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

export const updateUserSchema = z.object({
  body: z
    .object({
      firstName: z.string().trim().min(1).optional(),
      lastName: z.string().trim().min(1).optional(),
      role: z.enum(ROLES).optional(),
      isActive: z.boolean().optional()
    })
    // An empty PATCH is almost always a client bug; failing loudly beats a
    // silent no-op that looks like it worked.
    .refine((body) => Object.keys(body).length > 0, {
      message: "Provide at least one field to update"
    }),
  params: z.object({ id: z.string().min(1) }),
  query: z.object({}).optional()
});
