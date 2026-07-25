import type { SavedViewFilters, SavedViewPage } from "../../../api/savedViews.api";
import { useAuthStore } from "../../../auth/auth.store";
import { hasPermission } from "../../../lib/permissions";
import { Card } from "../../../components/ui/card";
import { DateRangePicker } from "./DateRangePicker";
import { SavedViewsMenu } from "./SavedViewsMenu";

export function DashboardFilterBar(props: {
  startDate: string;
  endDate: string;
  interval: string;
  onRangeChange: (filters: { startDate: string; endDate: string }) => void;
  onIntervalChange: (interval: string) => void;
  /**
   * Which page's saved views to offer. Omit to hide the saved-views control —
   * useful for surfaces where a saved filter set makes no sense.
   */
  savedViewsPage?: SavedViewPage;
  /** Omit to hide the comparison toggle on surfaces where it makes no sense. */
  compare?: boolean;
  onCompareChange?: (compare: boolean) => void;
  /** Admin-only cache bypass. Omit to hide the control entirely. */
  onForceRefresh?: () => void;
  currentFilters?: SavedViewFilters;
  onApplySavedView?: (filters: SavedViewFilters) => void;
}) {
  const role = useAuthStore((state) => state.user?.role);
  const granted = useAuthStore((state) => state.user?.permissions);
  // Bypassing the cache forces a full recomputation, so it is gated on the same
  // permission the API checks rather than shown to everyone and refused.
  const canForceRefresh = hasPermission(role, "users:manage", granted);

  return (
    <Card className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Filters</p>
        <h2 className="mt-1 text-lg font-semibold">Date range and chart granularity</h2>
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        {props.savedViewsPage && props.onApplySavedView ? (
          <SavedViewsMenu
            page={props.savedViewsPage}
            currentFilters={props.currentFilters ?? {}}
            onApply={props.onApplySavedView}
          />
        ) : null}
        {props.onCompareChange ? (
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <input
              type="checkbox"
              checked={props.compare ?? false}
              onChange={(event) => props.onCompareChange!(event.target.checked)}
            />
            Compare to previous period
          </label>
        ) : null}
        <DateRangePicker startDate={props.startDate} endDate={props.endDate} onChange={props.onRangeChange} />
        {props.onForceRefresh && canForceRefresh ? (
          <button
            type="button"
            onClick={props.onForceRefresh}
            title="Recompute now, ignoring cached results"
            className="rounded-2xl border border-[var(--border)] px-4 py-3 text-sm font-medium"
          >
            Refresh data
          </button>
        ) : null}
        <select
          value={props.interval}
          onChange={(event) => props.onIntervalChange(event.target.value)}
          className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm"
        >
          <option value="day">Daily</option>
          <option value="week">Weekly</option>
        </select>
      </div>
    </Card>
  );
}
