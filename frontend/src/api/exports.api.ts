import { apiClient, apiFetch } from "./client";

export type ExportType =
  | "TRACKED_EVENTS"
  | "AUDIT_EVENTS"
  | "KPI_SUMMARY"
  | "MONITORING_METRICS";

/** Union of every export type's filters; the API validates per type. */
export interface ExportFilters {
  startDate: string;
  endDate: string;
  eventType?: string;
  action?: string;
  actorId?: string;
  entityType?: string;
  search?: string;
  metricType?: string;
}

export interface ExportJob {
  id: string;
  exportType: ExportType;
  status: string;
  createdAt: string;
  rowCount: number | null;
  fileUrl?: string | null;
  errorMessage?: string | null;
  completedAt?: string | null;
  filtersJson?: ExportFilters | null;
}

export function getExportJobs() {
  return apiClient<ExportJob[]>("/api/exports");
}

export function createExportJob(payload: { exportType: ExportType; filters: ExportFilters }) {
  return apiClient<ExportJob>("/api/exports", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function estimateExport(payload: { exportType: ExportType; filters: ExportFilters }) {
  return apiClient<{ rowCount: number; willQueue: boolean; maxSyncRows: number }>(
    "/api/exports/estimate",
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export function retryExportJob(id: string) {
  return apiClient<ExportJob>(`/api/exports/${id}/retry`, {
    method: "POST"
  });
}

export async function downloadExportJob(id: string) {
  const response = await apiFetch(`/api/exports/${id}/download`);
  return response.blob();
}

/** Compact one-line description of what a job exported, for the history table. */
export function describeFilters(job: ExportJob) {
  const filters = job.filtersJson;
  if (!filters) {
    return "—";
  }

  const parts = [`${filters.startDate}→${filters.endDate}`];
  for (const key of ["eventType", "action", "entityType", "metricType", "search"] as const) {
    if (filters[key]) {
      parts.push(String(filters[key]));
    }
  }

  return parts.join(" · ");
}
