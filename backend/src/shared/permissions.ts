// Type-only import: this module must stay free of runtime dependencies so the
// frontend's drift test can import it directly without pulling in Prisma.
import type { Role } from "@prisma/client";

export type Permission =
  | "users:manage"
  | "dashboard:view"
  | "dashboard:configure"
  | "events:view"
  | "audit:view"
  | "monitoring:view"
  | "exports:create"
  | "exports:view"
  | "views:manage"
  | "alerts:manage"
  | "events:write"
  | "monitoring:write";

/**
 * The single source of truth for who can do what.
 *
 * Exported (it used to be module-private) so that the API can report a role's
 * permissions to the client, and so tests can assert against it directly.
 * Nothing may hard-code a role list to make an access decision — derive it from
 * here instead, or the three copies of the rules drift apart again.
 */
export const PERMISSIONS: Record<Role, readonly Permission[]> = {
  SYSTEM_ADMIN: [
    "users:manage",
    "dashboard:view",
    "dashboard:configure",
    "events:view",
    "audit:view",
    "monitoring:view",
    "exports:create",
    "exports:view",
    "views:manage",
    "alerts:manage",
    "events:write",
    "monitoring:write"
  ],
  OPS_MANAGER: [
    "dashboard:view",
    "dashboard:configure",
    "events:view",
    "exports:create",
    "exports:view",
    "views:manage",
    "events:write"
  ],
  PRODUCT_MANAGER: [
    "dashboard:view",
    "dashboard:configure",
    "events:view",
    "exports:create",
    "exports:view",
    "views:manage",
    "events:write"
  ],
  ENGINEERING_ADMIN: [
    "dashboard:view",
    "dashboard:configure",
    "monitoring:view",
    "exports:create",
    "exports:view",
    "views:manage",
    "alerts:manage",
    "events:write",
    "monitoring:write"
  ],
  AUDIT_VIEWER: ["dashboard:view", "audit:view", "exports:create", "exports:view", "views:manage", "events:write"],
  EXECUTIVE_VIEWER: ["dashboard:view"],
  READ_ONLY: ["dashboard:view"]
};

export function hasPermission(role: Role, permission: Permission) {
  return PERMISSIONS[role].includes(permission);
}

/** Returned to the client so the UI can hide what the API would refuse. */
export function getPermissionsForRole(role: Role): Permission[] {
  return [...PERMISSIONS[role]];
}

export function applyMetricVisibility<T extends Record<string, unknown>>(role: Role, metrics: T) {
  const hiddenKeysByRole: Partial<Record<Role, string[]>> = {
    EXECUTIVE_VIEWER: ["recentFailures", "adminActions"],
    READ_ONLY: ["averageApiLatencyMs", "backgroundJobFailures", "adminActions"],
    PRODUCT_MANAGER: ["backgroundJobFailures"],
    AUDIT_VIEWER: ["revenueProxy", "averageApiLatencyMs"]
  };

  const hiddenKeys = hiddenKeysByRole[role] ?? [];

  return Object.fromEntries(
    Object.entries(metrics).filter(([key]) => !hiddenKeys.includes(key))
  ) as T;
}
