import { useQuery } from "@tanstack/react-query";

import { getMonitoringSeries, getMonitoringSummary, getQueueDepth, getRecentJobFailures } from "../../../api/monitoring.api";
import { DataTable } from "../../../components/DataTable";
import { QueryBoundary } from "../../../components/QueryBoundary";
import { ChartCard } from "../components/ChartCard";
import { DashboardFilterBar } from "../components/DashboardFilterBar";
import { KpiCard } from "../components/KpiCard";
import { MetricSeriesChart } from "../components/MetricSeriesChart";
import { useDashboardFilters } from "../hooks/useDashboardFilters";

export function EngineeringDashboardPage() {
  const { filters, updateFilters } = useDashboardFilters();

  const summaryQuery = useQuery({
    queryKey: ["monitoring", "summary", filters.startDate, filters.endDate],
    queryFn: () => getMonitoringSummary({ startDate: filters.startDate, endDate: filters.endDate })
  });

  const errorRateQuery = useQuery({
    queryKey: ["monitoring", "error-rate", filters.startDate, filters.endDate],
    queryFn: () => getMonitoringSeries("error-rate", { startDate: filters.startDate, endDate: filters.endDate })
  });
  const apiLatencyQuery = useQuery({
    queryKey: ["monitoring", "api-latency", filters.startDate, filters.endDate],
    queryFn: () => getMonitoringSeries("api-latency", { startDate: filters.startDate, endDate: filters.endDate })
  });
  const dbQueryTimeQuery = useQuery({
    queryKey: ["monitoring", "db-query-time", filters.startDate, filters.endDate],
    queryFn: () => getMonitoringSeries("db-query-time", { startDate: filters.startDate, endDate: filters.endDate })
  });
  const queueDepthQuery = useQuery({
    queryKey: ["monitoring", "queue-depth"],
    queryFn: getQueueDepth
  });
  const jobFailuresQuery = useQuery({
    queryKey: ["monitoring", "recent-job-failures", filters.startDate, filters.endDate],
    queryFn: () => getRecentJobFailures({ startDate: filters.startDate, endDate: filters.endDate })
  });

  return (
    <div className="space-y-6">
      <DashboardFilterBar
        startDate={filters.startDate}
        endDate={filters.endDate}
        interval={filters.interval}
        onRangeChange={(range) => updateFilters(range)}
        onIntervalChange={(interval) => updateFilters({ interval })}
      />

      <QueryBoundary query={summaryQuery} loadingLabel="Loading engineering metrics..." isEmpty={() => false}>
        {(summary) => (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Avg API latency" value={`${summary.averageApiLatencyMs} ms`} />
            <KpiCard label="Avg DB query time" value={`${summary.averageDbQueryTimeMs} ms`} />
            <KpiCard label="Avg error rate" value={`${(summary.averageErrorRate * 100).toFixed(2)}%`} />
            <KpiCard
              label="Queue backlog"
              value={String(queueDepthQuery.data?.total ?? summary.queueDepth.total)}
            />
          </div>
        )}
      </QueryBoundary>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="API latency" description="Time-series monitoring feed for API responsiveness.">
          <QueryBoundary query={apiLatencyQuery} loadingLabel="Loading latency...">
            {(data) => <MetricSeriesChart data={data} />}
          </QueryBoundary>
        </ChartCard>
        <ChartCard title="DB query time" description="Database timing trend for engineering support workflows.">
          <QueryBoundary query={dbQueryTimeQuery} loadingLabel="Loading DB timings...">
            {(data) => <MetricSeriesChart data={data} color="#d97904" />}
          </QueryBoundary>
        </ChartCard>
      </div>

      <ChartCard title="Error rate over time" description="Monitoring metrics are ingested separately from tracked events.">
        <QueryBoundary query={errorRateQuery} loadingLabel="Loading error-rate series...">
          {(data) => <MetricSeriesChart data={data} color="#b73c20" />}
        </QueryBoundary>
      </ChartCard>

      <ChartCard title="Recent job failures" description="Background job failures are recorded as tracked events for support teams.">
        <QueryBoundary
          query={jobFailuresQuery}
          loadingLabel="Loading failed jobs..."
          emptyMessage="No background job failures in the selected range."
        >
          {(data) => (
            <DataTable
              rows={data}
              columns={[
                { key: "entityId", header: "Entity ID" },
                {
                  key: "metadata",
                  header: "Error",
                  render: (value) =>
                    typeof value === "object" && value !== null && "error" in value
                      ? String((value as { error?: string }).error ?? "Unknown")
                      : "Unknown"
                },
                {
                  key: "occurredAt",
                  header: "Occurred",
                  render: (value) => new Date(String(value)).toLocaleString()
                }
              ]}
            />
          )}
        </QueryBoundary>
      </ChartCard>
    </div>
  );
}
