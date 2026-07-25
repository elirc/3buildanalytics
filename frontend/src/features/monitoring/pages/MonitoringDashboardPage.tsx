import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  acknowledgeAlert,
  createAlertRule,
  deleteAlertRule,
  getAlertEvents,
  getAlertRules,
  updateAlertRule,
  type AlertEvent,
  type AlertRule,
  type MetricType
} from "../../../api/alerts.api";
import { getMonitoringSeries } from "../../../api/monitoring.api";
import { useAuthStore } from "../../../auth/auth.store";
import { QueryBoundary } from "../../../components/QueryBoundary";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { hasPermission } from "../../../lib/permissions";
import { formatDateTime } from "../../../lib/formatDate";
import { ChartCard } from "../../dashboard/components/ChartCard";
import { DashboardFilterBar } from "../../dashboard/components/DashboardFilterBar";
import { MetricSeriesChart } from "../../dashboard/components/MetricSeriesChart";
import { useDashboardFilters } from "../../dashboard/hooks/useDashboardFilters";

const METRIC_TYPES: MetricType[] = [
  "API_LATENCY",
  "ERROR_RATE",
  "JOB_FAILURE_RATE",
  "QUEUE_DEPTH",
  "DB_QUERY_TIME",
  "CACHE_HIT_RATE"
];

/**
 * The monitoring page.
 *
 * This used to be five lines re-exporting EngineeringDashboardPage, so two
 * sidebar links led to byte-identical pages. It is now about *alerting*: what
 * is wrong now, what the thresholds are, and the two charts the engineering
 * dashboard does not show.
 */
export function MonitoringDashboardPage() {
  const { filters, updateFilters } = useDashboardFilters();
  const queryClient = useQueryClient();
  const role = useAuthStore((state) => state.user?.role);
  const granted = useAuthStore((state) => state.user?.permissions);
  const canManage = hasPermission(role, "alerts:manage", granted);

  const [draft, setDraft] = useState({
    name: "",
    metricType: "API_LATENCY" as MetricType,
    comparator: "GREATER_THAN" as AlertRule["comparator"],
    threshold: 250,
    windowMinutes: 15
  });
  const [error, setError] = useState<string | null>(null);

  const rulesQuery = useQuery({ queryKey: ["alert-rules"], queryFn: getAlertRules });
  const eventsQuery = useQuery({
    queryKey: ["alert-events"],
    queryFn: () => getAlertEvents(),
    // Alerts are the one thing on this page that must not be stale.
    refetchInterval: 15_000
  });

  const cacheHitRateQuery = useQuery({
    queryKey: ["monitoring", "cache-hit-rate", filters.startDate, filters.endDate],
    queryFn: () =>
      getMonitoringSeries("cache-hit-rate", { startDate: filters.startDate, endDate: filters.endDate })
  });
  const jobFailureQuery = useQuery({
    queryKey: ["monitoring", "job-failures", filters.startDate, filters.endDate],
    queryFn: () =>
      getMonitoringSeries("job-failures", { startDate: filters.startDate, endDate: filters.endDate })
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["alert-rules"] });
    queryClient.invalidateQueries({ queryKey: ["alert-events"] });
  };

  const createMutation = useMutation({
    mutationFn: createAlertRule,
    onSuccess: () => {
      setDraft({ ...draft, name: "" });
      setError(null);
      invalidate();
    },
    onError: (mutationError: Error) => setError(mutationError.message)
  });
  const toggleMutation = useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) =>
      updateAlertRule(id, { isEnabled }),
    onSuccess: invalidate
  });
  const deleteMutation = useMutation({ mutationFn: deleteAlertRule, onSuccess: invalidate });
  const acknowledgeMutation = useMutation({ mutationFn: acknowledgeAlert, onSuccess: invalidate });

  return (
    <div className="space-y-6">
      <DashboardFilterBar
        startDate={filters.startDate}
        endDate={filters.endDate}
        interval={filters.interval}
        onRangeChange={(range) => updateFilters(range)}
        onIntervalChange={(interval) => updateFilters({ interval })}
      />

      <Card className="space-y-3">
        <h2 className="text-xl font-semibold">Active alerts</h2>
        <QueryBoundary
          query={eventsQuery}
          loadingLabel="Loading alerts..."
          emptyMessage="Nothing is firing. All monitored metrics are within their thresholds."
        >
          {(events) => (
            <ul className="space-y-2">
              {events.map((event: AlertEvent) => (
                <li
                  key={event.id}
                  className={[
                    "flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm",
                    event.status === "FIRING"
                      ? "border-[var(--danger)]/40 bg-red-50"
                      : "border-[var(--border)]"
                  ].join(" ")}
                >
                  <div>
                    <p className="font-medium">
                      {event.rule.name}{" "}
                      <span className="text-[var(--muted)]">
                        ({event.rule.metricType} {event.rule.comparator === "GREATER_THAN" ? ">" : "<"}{" "}
                        {event.rule.threshold})
                      </span>
                    </p>
                    <p className="text-[var(--muted)]">
                      Observed {event.observedValue.toFixed(2)} · fired {formatDateTime(event.firedAt)}
                      {event.resolvedAt ? ` · resolved ${formatDateTime(event.resolvedAt)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-medium">
                      {event.status}
                    </span>
                    {event.status === "FIRING" ? (
                      <button
                        type="button"
                        onClick={() => acknowledgeMutation.mutate(event.id)}
                        className="font-medium text-[var(--primary)]"
                      >
                        Acknowledge
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </QueryBoundary>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-xl font-semibold">Alert rules</h2>

        {canManage ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <input
              aria-label="Rule name"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="Rule name"
              className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm"
            />
            <select
              aria-label="Metric"
              value={draft.metricType}
              onChange={(event) => setDraft({ ...draft, metricType: event.target.value as MetricType })}
              className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm"
            >
              {METRIC_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <select
              aria-label="Comparator"
              value={draft.comparator}
              onChange={(event) =>
                setDraft({ ...draft, comparator: event.target.value as AlertRule["comparator"] })
              }
              className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm"
            >
              <option value="GREATER_THAN">is above</option>
              <option value="LESS_THAN">is below</option>
            </select>
            <input
              aria-label="Threshold"
              type="number"
              value={draft.threshold}
              onChange={(event) => setDraft({ ...draft, threshold: Number(event.target.value) })}
              className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm"
            />
            <Button
              onClick={() => createMutation.mutate(draft)}
              disabled={!draft.name.trim() || createMutation.isPending}
            >
              Add rule
            </Button>
          </div>
        ) : null}

        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

        <QueryBoundary query={rulesQuery} loadingLabel="Loading rules..." emptyMessage="No alert rules yet.">
          {(rules) => (
            <ul className="space-y-2">
              {rules.map((rule: AlertRule) => (
                <li
                  key={rule.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] px-4 py-3 text-sm"
                >
                  <span className={rule.isEnabled ? "" : "text-[var(--muted)] line-through"}>
                    {rule.name} — {rule.metricType}{" "}
                    {rule.comparator === "GREATER_THAN" ? ">" : "<"} {rule.threshold} over{" "}
                    {rule.windowMinutes}m
                  </span>
                  {canManage ? (
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          aria-label={`Enable ${rule.name}`}
                          checked={rule.isEnabled}
                          onChange={(event) =>
                            toggleMutation.mutate({ id: rule.id, isEnabled: event.target.checked })
                          }
                        />
                        Enabled
                      </label>
                      <button
                        type="button"
                        onClick={() => deleteMutation.mutate(rule.id)}
                        className="font-medium text-[var(--danger)]"
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </QueryBoundary>
      </Card>

      {/* The two series the engineering dashboard never showed. */}
      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Cache hit rate" description="How often cached dashboard reads avoid the database.">
          <QueryBoundary query={cacheHitRateQuery} loadingLabel="Loading cache hit rate...">
            {(data) => <MetricSeriesChart data={data} color="#2f7d63" />}
          </QueryBoundary>
        </ChartCard>
        <ChartCard title="Job failure rate" description="Background job failures as a proportion of runs.">
          <QueryBoundary query={jobFailureQuery} loadingLabel="Loading job failure rate...">
            {(data) => <MetricSeriesChart data={data} color="#b73c20" />}
          </QueryBoundary>
        </ChartCard>
      </div>
    </div>
  );
}
