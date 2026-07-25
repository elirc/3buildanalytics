import { apiClient } from "./client";
import type { DateRangeParams } from "./dashboard.api";

export function getMonitoringSummary(params: DateRangeParams) {
  const query = new URLSearchParams({
    startDate: params.startDate,
    endDate: params.endDate
  }).toString();
  return apiClient<{
    averageApiLatencyMs: number;
    averageErrorRate: number;
    averageJobFailureRate: number;
    averageCacheHitRate: number;
    averageDbQueryTimeMs: number;
    queueDepth: {
      pending: number;
      processing: number;
      failed: number;
      total: number;
    };
  }>(`/api/monitoring/summary?${query}`);
}

export function getMonitoringSeries(
  path: "api-latency" | "error-rate" | "job-failures" | "cache-hit-rate" | "db-query-time",
  params: DateRangeParams
) {
  const query = new URLSearchParams({
    startDate: params.startDate,
    endDate: params.endDate
  }).toString();
  return apiClient<Array<{ date: string; value: number; name: string }>>(`/api/monitoring/${path}?${query}`);
}

export interface QueueDepth {
  /** Flat fields kept for callers that only want a backlog number. */
  pending: number;
  processing: number;
  failed: number;
  total: number;
  /** Counted from ExportJob rows. A proxy — cannot see stuck or delayed jobs. */
  jobs: { pending: number; processing: number; failed: number; total: number };
  /** BullMQ's own counts. Null when Redis could not be reached. */
  queue: {
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    completed: number;
    paused: number;
  } | null;
  redisAvailable: boolean;
}

export function getQueueDepth() {
  return apiClient<QueueDepth>("/api/monitoring/queue-depth");
}

export function getRecentJobFailures(params: DateRangeParams) {
  const query = new URLSearchParams({
    startDate: params.startDate,
    endDate: params.endDate
  }).toString();

  return apiClient<Array<{ id: string; entityId: string | null; metadata: unknown; occurredAt: string }>>(
    `/api/monitoring/recent-job-failures?${query}`
  );
}
