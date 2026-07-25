import { apiClient } from "./client";

export type MetricType =
  | "API_LATENCY"
  | "ERROR_RATE"
  | "JOB_FAILURE_RATE"
  | "QUEUE_DEPTH"
  | "DB_QUERY_TIME"
  | "CACHE_HIT_RATE";

export interface AlertRule {
  id: string;
  name: string;
  metricType: MetricType;
  comparator: "GREATER_THAN" | "LESS_THAN";
  threshold: number;
  windowMinutes: number;
  isEnabled: boolean;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  rule: AlertRule;
  observedValue: number;
  status: "FIRING" | "ACKNOWLEDGED" | "RESOLVED";
  firedAt: string;
  resolvedAt: string | null;
}

export function getAlertRules() {
  return apiClient<AlertRule[]>("/api/alerts/rules");
}

export function createAlertRule(payload: {
  name: string;
  metricType: MetricType;
  comparator: "GREATER_THAN" | "LESS_THAN";
  threshold: number;
  windowMinutes?: number;
}) {
  return apiClient<AlertRule>("/api/alerts/rules", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateAlertRule(
  id: string,
  payload: { name?: string; threshold?: number; windowMinutes?: number; isEnabled?: boolean }
) {
  return apiClient<AlertRule>(`/api/alerts/rules/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function deleteAlertRule(id: string) {
  return apiClient<void>(`/api/alerts/rules/${id}`, { method: "DELETE" });
}

export function getAlertEvents(status?: AlertEvent["status"]) {
  return apiClient<AlertEvent[]>(`/api/alerts/events${status ? `?status=${status}` : ""}`);
}

export function acknowledgeAlert(id: string) {
  return apiClient<AlertEvent>(`/api/alerts/events/${id}/acknowledge`, { method: "POST" });
}
