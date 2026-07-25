import { apiClient } from "./client";

export interface DashboardConfig {
  id: string;
  name: string;
  role: string;
  description: string | null;
  isDefault: boolean;
  layoutJson: Record<string, unknown>;
}

/**
 * The default layout for a role, with widgets the caller cannot see already
 * stripped by the server. Returns null when the role has no saved config —
 * a normal state, not an error.
 */
export function getDefaultDashboardConfig(role?: string) {
  return apiClient<DashboardConfig | null>(
    `/api/dashboard-configs/default${role ? `?role=${encodeURIComponent(role)}` : ""}`
  );
}

export function getDashboardConfigs() {
  return apiClient<Array<{ id: string; name: string; role: string; description: string | null; isDefault: boolean; layoutJson: Record<string, unknown> }>>("/api/dashboard-configs");
}

export function createDashboardConfig(payload: {
  name: string;
  description?: string;
  role: string;
  isDefault?: boolean;
  layoutJson: Record<string, unknown>;
}) {
  return apiClient("/api/dashboard-configs", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateDashboardConfig(
  id: string,
  payload: Partial<{
    name: string;
    description: string;
    role: string;
    isDefault: boolean;
    layoutJson: Record<string, unknown>;
  }>
) {
  return apiClient(`/api/dashboard-configs/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function deleteDashboardConfig(id: string) {
  return apiClient<void>(`/api/dashboard-configs/${id}`, {
    method: "DELETE"
  });
}
