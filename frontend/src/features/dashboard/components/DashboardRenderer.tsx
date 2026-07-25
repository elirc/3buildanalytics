import { useQuery } from "@tanstack/react-query";

import {
  getActiveUsers,
  getConversionFunnel,
  getErrorRateSeries,
  getRecentActivity
} from "../../../api/dashboard.api";
import { getMonitoringSeries, getQueueDepth, getRecentJobFailures } from "../../../api/monitoring.api";
import { DataTable } from "../../../components/DataTable";
import { QueryBoundary } from "../../../components/QueryBoundary";
import { ChartCard } from "./ChartCard";
import { ConversionFunnelChart } from "./ConversionFunnelChart";
import { ErrorRateChart } from "./ErrorRateChart";
import { EventsByTypeChart } from "./EventsByTypeChart";
import { EventsOverTimeChart } from "./EventsOverTimeChart";
import { KpiCard } from "./KpiCard";
import { KpiCardGrid } from "./KpiCardGrid";
import { MetricSeriesChart } from "./MetricSeriesChart";
import { RecentActivityTable } from "./RecentActivityTable";
import { useEventsByType } from "../hooks/useEventsByType";
import { useEventsOverTime } from "../hooks/useEventsOverTime";
import { useKpiSummary } from "../hooks/useKpiSummary";
import { WIDGET_REGISTRY, isKnownWidget, type DashboardLayout } from "../widgetRegistry";

interface Filters {
  startDate: string;
  endDate: string;
  interval: string;
}

/**
 * Renders a dashboard from a layout instead of from hardcoded JSX.
 *
 * Each widget owns its own query and its own QueryBoundary, so one failing
 * endpoint degrades one card rather than the page. Unknown ids are skipped with
 * a console warning rather than throwing — a config written by a newer build
 * should not break an older one.
 */
export function DashboardRenderer({ layout, filters }: { layout: DashboardLayout; filters: Filters }) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {layout.widgets.map((widget, index) => {
        if (!isKnownWidget(widget.id)) {
          console.warn(`Unknown dashboard widget "${widget.id}" — skipping.`);
          return null;
        }

        const definition = WIDGET_REGISTRY[widget.id];

        return (
          <div
            key={`${widget.id}-${index}`}
            className={widget.size === "full" ? "xl:col-span-2" : "xl:col-span-1"}
          >
            <Widget id={widget.id} title={definition.title} description={definition.description} filters={filters} />
          </div>
        );
      })}
    </div>
  );
}

function Widget({
  id,
  title,
  description,
  filters
}: {
  id: keyof typeof WIDGET_REGISTRY;
  title: string;
  description: string;
  filters: Filters;
}) {
  switch (id) {
    case "kpi-summary":
      return <KpiSummaryWidget filters={filters} />;
    case "events-over-time":
      return <EventsOverTimeWidget title={title} description={description} filters={filters} />;
    case "events-by-type":
      return <EventsByTypeWidget title={title} description={description} filters={filters} />;
    case "active-users":
      return <ActiveUsersWidget title={title} description={description} filters={filters} />;
    case "error-rate":
      return <ErrorRateWidget title={title} description={description} filters={filters} />;
    case "conversion-funnel":
      return <FunnelWidget title={title} description={description} filters={filters} />;
    case "recent-activity":
      return <RecentActivityWidget title={title} description={description} filters={filters} />;
    case "api-latency":
      return <MonitoringSeriesWidget metric="api-latency" title={title} description={description} filters={filters} />;
    case "db-query-time":
      return <MonitoringSeriesWidget metric="db-query-time" title={title} description={description} filters={filters} color="#d97904" />;
    case "queue-depth":
      return <QueueDepthWidget title={title} description={description} />;
    case "job-failures":
      return <JobFailuresWidget title={title} description={description} filters={filters} />;
    default:
      return null;
  }
}

function KpiSummaryWidget({ filters }: { filters: Filters }) {
  const query = useKpiSummary(filters.startDate, filters.endDate);
  return (
    <QueryBoundary query={query} loadingLabel="Loading KPI summary..." isEmpty={() => false}>
      {(data) => <KpiCardGrid data={data} />}
    </QueryBoundary>
  );
}

function EventsOverTimeWidget({ title, description, filters }: { title: string; description: string; filters: Filters }) {
  const query = useEventsOverTime(filters.startDate, filters.endDate, filters.interval);
  return (
    <ChartCard title={title} description={description}>
      <QueryBoundary query={query} loadingLabel="Loading event trend..." isEmpty={(data) => data.data.length === 0}>
        {(data) => <EventsOverTimeChart data={data.data} />}
      </QueryBoundary>
    </ChartCard>
  );
}

function EventsByTypeWidget({ title, description, filters }: { title: string; description: string; filters: Filters }) {
  const query = useEventsByType(filters.startDate, filters.endDate);
  return (
    <ChartCard title={title} description={description}>
      <QueryBoundary query={query} loadingLabel="Loading event mix...">
        {(data) => <EventsByTypeChart data={data} />}
      </QueryBoundary>
    </ChartCard>
  );
}

function ActiveUsersWidget({ title, description, filters }: { title: string; description: string; filters: Filters }) {
  const query = useQuery({
    queryKey: ["dashboard", "active-users", filters.startDate, filters.endDate, filters.interval],
    queryFn: () => getActiveUsers({ startDate: filters.startDate, endDate: filters.endDate, interval: filters.interval })
  });

  return (
    <ChartCard title={title} description={description}>
      <QueryBoundary query={query} loadingLabel="Loading active users...">
        {(data) => <MetricSeriesChart data={data.map((item) => ({ date: item.date, value: item.activeUsers }))} />}
      </QueryBoundary>
    </ChartCard>
  );
}

function ErrorRateWidget({ title, description, filters }: { title: string; description: string; filters: Filters }) {
  const query = useQuery({
    queryKey: ["dashboard", "error-rate", filters.startDate, filters.endDate, filters.interval],
    queryFn: () =>
      getErrorRateSeries({ startDate: filters.startDate, endDate: filters.endDate, interval: filters.interval })
  });

  return (
    <ChartCard title={title} description={description}>
      <QueryBoundary query={query} loadingLabel="Loading error-rate trend...">
        {(data) => <ErrorRateChart data={data.map((point) => ({ date: point.date, value: point.errorRate }))} />}
      </QueryBoundary>
    </ChartCard>
  );
}

function FunnelWidget({ title, description, filters }: { title: string; description: string; filters: Filters }) {
  const query = useQuery({
    queryKey: ["dashboard", "funnel", filters.startDate, filters.endDate],
    queryFn: () => getConversionFunnel({ startDate: filters.startDate, endDate: filters.endDate })
  });

  return (
    <ChartCard title={title} description={description}>
      <QueryBoundary query={query} loadingLabel="Loading funnel...">
        {(data) => <ConversionFunnelChart data={data} />}
      </QueryBoundary>
    </ChartCard>
  );
}

function RecentActivityWidget({ title, description, filters }: { title: string; description: string; filters: Filters }) {
  const query = useQuery({
    queryKey: ["dashboard", "recent-activity", filters.startDate, filters.endDate],
    queryFn: () => getRecentActivity({ startDate: filters.startDate, endDate: filters.endDate })
  });

  return (
    <ChartCard title={title} description={description}>
      <QueryBoundary query={query} loadingLabel="Loading activity..." emptyMessage="No activity in the selected range.">
        {(data) => <RecentActivityTable data={data} />}
      </QueryBoundary>
    </ChartCard>
  );
}

function MonitoringSeriesWidget({
  metric,
  title,
  description,
  filters,
  color
}: {
  // Narrowed to the series the monitoring API actually exposes, so a typo here
  // is a compile error rather than a 404 at runtime.
  metric: Parameters<typeof getMonitoringSeries>[0];
  title: string;
  description: string;
  filters: Filters;
  color?: string;
}) {
  const query = useQuery({
    queryKey: ["monitoring", metric, filters.startDate, filters.endDate],
    queryFn: () => getMonitoringSeries(metric, { startDate: filters.startDate, endDate: filters.endDate })
  });

  return (
    <ChartCard title={title} description={description}>
      <QueryBoundary query={query} loadingLabel={`Loading ${title.toLowerCase()}...`}>
        {(data) => <MetricSeriesChart data={data} color={color} />}
      </QueryBoundary>
    </ChartCard>
  );
}

function QueueDepthWidget({ title, description }: { title: string; description: string }) {
  const query = useQuery({ queryKey: ["monitoring", "queue-depth"], queryFn: getQueueDepth });

  return (
    <ChartCard title={title} description={description}>
      <QueryBoundary query={query} loadingLabel="Loading queue depth..." isEmpty={() => false}>
        {(data) => <KpiCard label="Queue backlog" value={String(data.total)} />}
      </QueryBoundary>
    </ChartCard>
  );
}

function JobFailuresWidget({ title, description, filters }: { title: string; description: string; filters: Filters }) {
  const query = useQuery({
    queryKey: ["monitoring", "recent-job-failures", filters.startDate, filters.endDate],
    queryFn: () => getRecentJobFailures({ startDate: filters.startDate, endDate: filters.endDate })
  });

  return (
    <ChartCard title={title} description={description}>
      <QueryBoundary
        query={query}
        loadingLabel="Loading failed jobs..."
        emptyMessage="No background job failures in the selected range."
      >
        {(data) => (
          <DataTable
            rows={data}
            columns={[
              { key: "entityId", header: "Entity ID" },
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
  );
}
