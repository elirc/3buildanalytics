import { useQuery } from "@tanstack/react-query";

import { getEventsOverTime, getKpiSummary } from "../../../api/dashboard.api";
import { QueryBoundary } from "../../../components/QueryBoundary";
import { ChartCard } from "../components/ChartCard";
import { DashboardFilterBar } from "../components/DashboardFilterBar";
import { EventsOverTimeChart } from "../components/EventsOverTimeChart";
import { KpiCardGrid } from "../components/KpiCardGrid";
import { useDashboardFilters } from "../hooks/useDashboardFilters";

export function ExecutiveDashboardPage() {
  const { filters, updateFilters } = useDashboardFilters();
  const kpis = useQuery({
    queryKey: ["executive", "kpis", filters.startDate, filters.endDate],
    queryFn: () => getKpiSummary({ startDate: filters.startDate, endDate: filters.endDate })
  });
  const trend = useQuery({
    queryKey: ["executive", "trend", filters.startDate, filters.endDate, filters.interval],
    queryFn: () => getEventsOverTime({ startDate: filters.startDate, endDate: filters.endDate, interval: filters.interval })
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

      <QueryBoundary query={kpis} loadingLabel="Loading executive summary..." isEmpty={() => false}>
        {(data) => <KpiCardGrid data={data} />}
      </QueryBoundary>

      <ChartCard title="Trend overview" description="Executive views stay summary-first and avoid raw operational feeds.">
        <QueryBoundary
          query={trend}
          loadingLabel="Loading summary trend..."
          isEmpty={(data) => data.data.length === 0}
        >
          {(data) => <EventsOverTimeChart data={data.data} />}
        </QueryBoundary>
      </ChartCard>
    </div>
  );
}
