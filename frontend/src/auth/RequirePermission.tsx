import { Navigate, Outlet } from "react-router-dom";

import { useAuthStore } from "./auth.store";
import { hasPermission, type Permission } from "../lib/permissions";

/**
 * Route guard that gates on a permission rather than a list of roles.
 *
 * Replaces the hard-coded role arrays that used to live in router.tsx. Those
 * arrays were a third copy of the access rules, and they disagreed with the
 * backend: a read-only user could reach /exports and an ops manager could reach
 * /engineering, in both cases only to meet a 403 from the API.
 *
 * Gating on the same permission the API checks means the two cannot disagree.
 */
export function RequirePermission({ permission }: { permission: Permission }) {
  const role = useAuthStore((state) => state.user?.role);
  const granted = useAuthStore((state) => state.user?.permissions);

  if (!hasPermission(role, permission, granted)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
