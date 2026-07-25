import { useQuery } from "@tanstack/react-query";

import { getDefaultDashboardConfig } from "../../../api/dashboardConfigs.api";
import { useAuthStore } from "../../../auth/auth.store";
import { DashboardFilterBar } from "../components/DashboardFilterBar";
import { DashboardRenderer } from "../components/DashboardRenderer";
import { useDashboardFilters } from "../hooks/useDashboardFilters";
import { FALLBACK_LAYOUT, type DashboardLayout } from "../widgetRegistry";

/**
 * Renders from the role's saved dashboard config rather than hardcoded JSX.
 *
 * Only this page is converted for now. One page proves the pattern; converting
 * all four in the same change would make the diff hard to review and would
 * couple four unrelated regressions to one merge.
 */
export function OperationsDashboardPage() {
  const { filters, updateFilters } = useDashboardFilters();
  const role = useAuthStore((state) => state.user?.role);

  const configQuery = useQuery({
    queryKey: ["dashboard-config", "default", role],
    queryFn: () => getDefaultDashboardConfig(),
    // A missing config is a normal state, not an error worth retrying.
    retry: false
  });

  // Falls back to the built-in layout when no config exists or the request
  // fails, so a dashboard-config problem never leaves the user with a blank
  // page. The layout is the presentation; the data is what matters.
  const savedLayout = configQuery.data?.layoutJson as unknown as DashboardLayout | undefined;
  const layout: DashboardLayout = savedLayout?.widgets?.length ? savedLayout : FALLBACK_LAYOUT;

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
        onApplySavedView={(saved) => updateFilters(saved)}
        compare={filters.compare}
        onCompareChange={(compare) => updateFilters({ compare: compare ? "1" : "" })}
      />

      <DashboardRenderer layout={layout} filters={filters} />
    </div>
  );
}
