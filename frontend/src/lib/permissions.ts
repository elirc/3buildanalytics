import type { Role } from "../auth/auth.store";

/**
 * Client-side mirror of the backend permission matrix
 * (backend/src/shared/permissions.ts).
 *
 * The backend remains the authority — it enforces on every request, and the
 * session payload carries the caller's real permission list. This mirror exists
 * so the very first render can draw the correct navigation without waiting on a
 * round trip.
 *
 * Because it is a copy, it can drift. src/test/permissionParity.test.ts imports
 * the backend module directly and fails if these two disagree, so drift is a
 * red build rather than a support ticket.
 */
export type Permission =
  | "users:manage"
  | "dashboard:view"
  | "dashboard:configure"
  | "events:view"
  | "audit:view"
  | "monitoring:view"
  | "exports:create"
  | "exports:view";

export const PERMISSIONS: Record<Role, readonly Permission[]> = {
  SYSTEM_ADMIN: [
    "users:manage",
    "dashboard:view",
    "dashboard:configure",
    "events:view",
    "audit:view",
    "monitoring:view",
    "exports:create",
    "exports:view"
  ],
  OPS_MANAGER: [
    "dashboard:view",
    "dashboard:configure",
    "events:view",
    "exports:create",
    "exports:view"
  ],
  PRODUCT_MANAGER: [
    "dashboard:view",
    "dashboard:configure",
    "events:view",
    "exports:create",
    "exports:view"
  ],
  ENGINEERING_ADMIN: [
    "dashboard:view",
    "dashboard:configure",
    "monitoring:view",
    "exports:create",
    "exports:view"
  ],
  AUDIT_VIEWER: ["dashboard:view", "audit:view", "exports:create", "exports:view"],
  EXECUTIVE_VIEWER: ["dashboard:view"],
  READ_ONLY: ["dashboard:view"]
};

/**
 * Prefers the permission list the server issued with the session and falls back
 * to the local mirror. Passing the server list through means a backend change
 * takes effect on the next login even before the frontend is redeployed.
 */
export function hasPermission(
  role: Role | undefined,
  permission: Permission,
  grantedPermissions?: readonly Permission[]
) {
  if (grantedPermissions) {
    return grantedPermissions.includes(permission);
  }

  if (!role) {
    return false;
  }

  return PERMISSIONS[role].includes(permission);
}

// Named helpers kept as thin wrappers so existing call sites keep reading well.
// They must never contain their own role lists — that is how the rules drifted.
export const canViewEvents = (role: Role) => hasPermission(role, "events:view");
export const canViewAudit = (role: Role) => hasPermission(role, "audit:view");
export const canViewMonitoring = (role: Role) => hasPermission(role, "monitoring:view");
export const canManageUsers = (role: Role) => hasPermission(role, "users:manage");
export const canConfigureDashboards = (role: Role) => hasPermission(role, "dashboard:configure");
export const canViewExports = (role: Role) => hasPermission(role, "exports:view");
