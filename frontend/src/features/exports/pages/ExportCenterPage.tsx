import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  createExportJob,
  describeFilters,
  downloadExportJob,
  estimateExport,
  getExportJobs,
  retryExportJob,
  type ExportFilters,
  type ExportJob,
  type ExportType
} from "../../../api/exports.api";
import { DataTable } from "../../../components/DataTable";
import { QueryBoundary } from "../../../components/QueryBoundary";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { formatDateTime, getDefaultDateRange } from "../../../lib/formatDate";

const EXPORT_TYPES: Array<{ value: ExportType; label: string }> = [
  { value: "TRACKED_EVENTS", label: "Tracked events" },
  { value: "AUDIT_EVENTS", label: "Audit events" },
  { value: "KPI_SUMMARY", label: "KPI summary" },
  { value: "MONITORING_METRICS", label: "Monitoring metrics" }
];

const EVENT_TYPES = [
  "USER_SIGNED_UP",
  "USER_LOGGED_IN",
  "USER_LOGIN_FAILED",
  "FEATURE_USED",
  "RECORD_CREATED",
  "RECORD_UPDATED",
  "RECORD_DELETED",
  "CSV_EXPORTED",
  "API_ERROR",
  "BACKGROUND_JOB_FAILED",
  "ADMIN_ACTION"
];

const METRIC_TYPES = [
  "API_LATENCY",
  "ERROR_RATE",
  "JOB_FAILURE_RATE",
  "QUEUE_DEPTH",
  "DB_QUERY_TIME",
  "CACHE_HIT_RATE"
];

export function ExportCenterPage() {
  const queryClient = useQueryClient();
  const defaultRange = getDefaultDateRange();

  const [exportType, setExportType] = useState<ExportType>("TRACKED_EVENTS");
  const [filters, setFilters] = useState<ExportFilters>({
    startDate: defaultRange.startDate,
    endDate: defaultRange.endDate
  });
  const [estimate, setEstimate] = useState<{ rowCount: number; willQueue: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportJobsQuery = useQuery({ queryKey: ["exports"], queryFn: getExportJobs });

  // Filters are per-type; carrying eventType into an audit export would be
  // rejected by the API's .strict() schema.
  function changeType(next: ExportType) {
    setExportType(next);
    setFilters({ startDate: filters.startDate, endDate: filters.endDate });
    setEstimate(null);
  }

  // Debounced so typing in a filter does not fire a count per keystroke.
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const result = await estimateExport({ exportType, filters: cleanFilters(filters) });
        setEstimate(result);
        setError(null);
      } catch (estimateError) {
        setEstimate(null);
        setError(estimateError instanceof Error ? estimateError.message : "Could not estimate");
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [exportType, filters]);

  const createMutation = useMutation({
    mutationFn: () => createExportJob({ exportType, filters: cleanFilters(filters) }),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["exports"] });
    },
    onError: (mutationError: Error) => setError(mutationError.message)
  });

  const retryMutation = useMutation({
    mutationFn: retryExportJob,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["exports"] })
  });

  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Export center</p>
          <h2 className="mt-1 text-xl font-semibold">Build an export</h2>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--muted)]">Export type</span>
            <select
              value={exportType}
              onChange={(event) => changeType(event.target.value as ExportType)}
              className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3"
            >
              {EXPORT_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--muted)]">From</span>
            <input
              type="date"
              value={filters.startDate}
              onChange={(event) => setFilters({ ...filters, startDate: event.target.value })}
              className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--muted)]">To</span>
            <input
              type="date"
              value={filters.endDate}
              onChange={(event) => setFilters({ ...filters, endDate: event.target.value })}
              className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3"
            />
          </label>

          {exportType === "TRACKED_EVENTS" ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[var(--muted)]">Event type</span>
              <select
                value={filters.eventType ?? ""}
                onChange={(event) =>
                  setFilters({ ...filters, eventType: event.target.value || undefined })
                }
                className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3"
              >
                <option value="">All</option>
                {EVENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {exportType === "AUDIT_EVENTS" ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[var(--muted)]">Action</span>
              <input
                value={filters.action ?? ""}
                onChange={(event) =>
                  setFilters({ ...filters, action: event.target.value || undefined })
                }
                placeholder="e.g. USER_ROLE_CHANGED"
                className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3"
              />
            </label>
          ) : null}

          {exportType === "MONITORING_METRICS" ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[var(--muted)]">Metric</span>
              <select
                value={filters.metricType ?? ""}
                onChange={(event) =>
                  setFilters({ ...filters, metricType: event.target.value || undefined })
                }
                className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3"
              >
                <option value="">All</option>
                {METRIC_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating..." : "Create export"}
          </Button>

          {estimate ? (
            <p className="text-sm text-[var(--muted)]">
              About {estimate.rowCount.toLocaleString()} rows.
              {estimate.willQueue
                ? " This is large, so it will be queued and processed in the background."
                : " This will be ready immediately."}
            </p>
          ) : null}
        </div>

        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      </Card>

      <QueryBoundary
        query={exportJobsQuery}
        loadingLabel="Loading export history..."
        emptyMessage="No exports yet. Create one above."
      >
        {(jobs) => (
          <DataTable
            rows={jobs}
            columns={[
              { key: "exportType", header: "Type" },
              {
                key: "filtersJson",
                header: "Filters",
                // Without this the history is four identical-looking rows and
                // "which one was the API errors?" is unanswerable.
                render: (_value, row) => describeFilters(row as ExportJob)
              },
              { key: "status", header: "Status" },
              {
                key: "createdAt",
                header: "Created",
                render: (value) => formatDateTime(String(value))
              },
              { key: "rowCount", header: "Rows" },
              {
                key: "id",
                header: "Actions",
                render: (_value, row) => {
                  const job = row as ExportJob;

                  return (
                    <div className="flex gap-3">
                      {job.status === "COMPLETED" ? (
                        <button
                          className="font-medium text-[var(--primary)]"
                          onClick={async () => {
                            const blob = await downloadExportJob(job.id);
                            const url = URL.createObjectURL(blob);
                            const anchor = document.createElement("a");
                            anchor.href = url;
                            anchor.download = `${job.exportType.toLowerCase()}.csv`;
                            anchor.click();
                            URL.revokeObjectURL(url);
                          }}
                        >
                          Download
                        </button>
                      ) : null}
                      {job.status === "FAILED" ? (
                        <button
                          className="font-medium text-[var(--danger)]"
                          onClick={() => retryMutation.mutate(job.id)}
                        >
                          Retry
                        </button>
                      ) : null}
                      {job.filtersJson ? (
                        <button
                          className="font-medium text-[var(--muted)]"
                          onClick={() => {
                            setExportType(job.exportType);
                            setFilters(job.filtersJson!);
                          }}
                        >
                          Run again
                        </button>
                      ) : null}
                    </div>
                  );
                }
              }
            ]}
          />
        )}
      </QueryBoundary>
    </div>
  );
}

/** Drops empty optional filters so `.strict()` does not see `eventType: ""`. */
function cleanFilters(filters: ExportFilters): ExportFilters {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined && value !== "")
  ) as ExportFilters;
}
