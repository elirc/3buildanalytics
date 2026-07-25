import { apiClient } from "./client";

export interface DateRangeParams {
  startDate: string;
  endDate: string;
}

/**
 * A KPI metric.
 *
 * Without ?compare it is a bare number; with it, an object carrying the
 * previous period's value and the change. Both shapes are modelled so the
 * comparison feature did not have to break every existing caller.
 */
export type KpiMetric = number | { value: number; previous: number | null; changePercent: number | null };

export interface KpiSummary {
  totalEvents: KpiMetric;
  activeUsers: KpiMetric;
  failedEvents: KpiMetric;
  errorRate: KpiMetric;
  csvExports: KpiMetric;
  // Absent when the caller's role may not see them (applyMetricVisibility).
  adminActions?: KpiMetric;
  averageApiLatencyMs?: KpiMetric;
  backgroundJobFailures?: KpiMetric;
  _meta?: {
    source: "live" | "snapshot";
    compare?: "previous_period";
    previousPeriod?: { startDate: string; endDate: string };
  };
}

export interface EventsOverTimeResponse {
  interval: string;
  data: { date: string; count: number }[];
}

export interface ErrorRatePoint {
  date: string;
  totalEvents: number;
  failedEvents: number;
  errorRate: number;
}

export function getKpiSummary(params: DateRangeParams & { compare?: boolean }) {
  const query = new URLSearchParams({
    startDate: params.startDate,
    endDate: params.endDate,
    ...(params.compare ? { compare: "previous_period" } : {})
  }).toString();
  return apiClient<KpiSummary>(`/api/dashboard/kpi-summary?${query}`);
}

export function getEventsOverTime(params: DateRangeParams & { interval?: string }) {
  const query = new URLSearchParams(
    Object.entries(params).reduce<Record<string, string>>((accumulator, [key, value]) => {
      if (value) accumulator[key] = value;
      return accumulator;
    }, {})
  ).toString();

  return apiClient<EventsOverTimeResponse>(`/api/dashboard/events-over-time?${query}`);
}

export function getEventsByType(params: DateRangeParams) {
  const query = new URLSearchParams({
    startDate: params.startDate,
    endDate: params.endDate
  }).toString();
  return apiClient<Array<{ eventType: string; count: number }>>(`/api/dashboard/events-by-type?${query}`);
}

export function getRecentActivity(params: DateRangeParams) {
  const query = new URLSearchParams({
    startDate: params.startDate,
    endDate: params.endDate
  }).toString();
  return apiClient<Array<{ id: string; eventType: string; actorEmail: string | null; occurredAt: string }>>(
    `/api/dashboard/recent-activity?${query}`
  );
}

export function getActiveUsers(params: DateRangeParams & { interval?: string }) {
  const query = new URLSearchParams(
    Object.entries(params).reduce<Record<string, string>>((accumulator, [key, value]) => {
      if (value) accumulator[key] = value;
      return accumulator;
    }, {})
  ).toString();

  return apiClient<Array<{ date: string; activeUsers: number }>>(`/api/dashboard/active-users?${query}`);
}

export function getErrorRateSeries(params: DateRangeParams & { interval?: string }) {
  const query = new URLSearchParams(
    Object.entries(params).reduce<Record<string, string>>((accumulator, [key, value]) => {
      if (value) accumulator[key] = value;
      return accumulator;
    }, {})
  ).toString();

  return apiClient<ErrorRatePoint[]>(`/api/dashboard/error-rate?${query}`);
}

export function getConversionFunnel(params: DateRangeParams) {
  const query = new URLSearchParams({
    startDate: params.startDate,
    endDate: params.endDate
  }).toString();

  return apiClient<Array<{ stage: string; count: number; conversionRate: number }>>(
    `/api/dashboard/conversion-funnel?${query}`
  );
}
