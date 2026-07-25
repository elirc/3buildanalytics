import { useQuery } from "@tanstack/react-query";

import { getErrorRateSeries, getRecentActivity } from "../../../api/dashboard.api";
import { QueryBoundary } from "../../../components/QueryBoundary";
import { ChartCard } from "../components/ChartCard";
import { DashboardFilterBar } from "../components/DashboardFilterBar";
import { ErrorRateChart } from "../components/ErrorRateChart";
import { EventsByTypeChart } from "../components/EventsByTypeChart";
import { EventsOverTimeChart } from "../components/EventsOverTimeChart";
import { KpiCardGrid } from "../components/KpiCardGrid";
import { RecentActivityTable } from "../components/RecentActivityTable";
import { useDashboardFilters } from "../hooks/useDashboardFilters";
import { useEventsByType } from "../hooks/useEventsByType";
import { useEventsOverTime } from "../hooks/useEventsOverTime";
import { useKpiSummary } from "../hooks/useKpiSummary";

export function OperationsDashboardPage() {
  const { filters, updateFilters } = useDashboardFilters();
  const kpiQuery = useKpiSummary(filters.startDate, filters.endDate);
  const eventsOverTimeQuery = useEventsOverTime(filters.startDate, filters.endDate, filters.interval);
  const eventsByTypeQuery = useEventsByType(filters.startDate, filters.endDate);
  const recentActivityQuery = useQuery({
    queryKey: ["dashboard", "recent-activity", filters.startDate, filters.endDate],
    queryFn: () => getRecentActivity({ startDate: filters.startDate, endDate: filters.endDate })
  });
  const errorRateQuery = useQuery({
    queryKey: ["dashboard", "error-rate", filters.startDate, filters.endDate, filters.interval],
    queryFn: () =>
      getErrorRateSeries({
        startDate: filters.startDate,
        endDate: filters.endDate,
        interval: filters.interval
      })
  });

  return (
    <div className="space-y-6">
      <DashboardFilterBar
        startDate={filters.startDate}
        endDate={filters.endDate}
        interval={filters.interval}
        onRangeChange={(range) => updateFilters(range)}
        onIntervalChange={(interval) => updateFilters({ interval })}
        savedViewsPage="operations"
        currentFilters={{
          startDate: filters.startDate,
          endDate: filters.endDate,
          interval: filters.interval as "day" | "week"
        }}
        // Applying a view just writes its filters into the URL; everything on
        // the page already reacts to that.
        onApplySavedView={(saved) => updateFilters(saved)}
      />

      {/* Each card owns its own loading/error/empty state, so one failing
          endpoint no longer blanks the whole page. */}
      <QueryBoundary query={kpiQuery} loadingLabel="Loading KPI summary..." isEmpty={() => false}>
        {(data) => <KpiCardGrid data={data} />}
      </QueryBoundary>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Events over time" description="Chart-ready server aggregation for event volume trends.">
          <QueryBoundary
            query={eventsOverTimeQuery}
            loadingLabel="Loading event trend..."
            isEmpty={(data) => data.data.length === 0}
          >
            {(data) => <EventsOverTimeChart data={data.data} />}
          </QueryBoundary>
        </ChartCard>
        <ChartCard title="Events by type" description="Backend aggregation keeps the frontend lightweight.">
          <QueryBoundary query={eventsByTypeQuery} loadingLabel="Loading event mix...">
            {(data) => <EventsByTypeChart data={data} />}
          </QueryBoundary>
        </ChartCard>
      </div>

      <ChartCard title="Error rate over time" description="Failure ratio is computed on the server from raw tracked events.">
        <QueryBoundary query={errorRateQuery} loadingLabel="Loading error-rate trend...">
          {(data) => (
            <ErrorRateChart data={data.map((point) => ({ date: point.date, value: point.errorRate }))} />
          )}
        </QueryBoundary>
      </ChartCard>

      <ChartCard title="Recent activity" description="A paged operational feed of the most recent tracked events in range.">
        <QueryBoundary
          query={recentActivityQuery}
          loadingLabel="Loading activity..."
          emptyMessage="No activity in the selected range."
        >
          {(data) => <RecentActivityTable data={data} />}
        </QueryBoundary>
      </ChartCard>
    </div>
  );
}
