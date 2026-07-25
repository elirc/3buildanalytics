import { Link } from "react-router-dom";

import { Card } from "../../../components/ui/card";
import { Pagination } from "../../../components/Pagination";
import { QueryBoundary } from "../../../components/QueryBoundary";
import { SortableHeader } from "../../../components/SortableHeader";
import { DashboardFilterBar } from "../../dashboard/components/DashboardFilterBar";
import { useDashboardFilters } from "../../dashboard/hooks/useDashboardFilters";
import { EventFilters } from "../components/EventFilters";
import { useEvents } from "../hooks/useEvents";

export function EventLogPage() {
  const { filters, updateFilters } = useDashboardFilters();
  const query = useEvents({
    startDate: filters.startDate,
    endDate: filters.endDate,
    eventType: filters.eventType || undefined,
    page: filters.page,
    pageSize: filters.pageSize,
    sortBy: filters.sortBy || undefined,
    sortDir: filters.sortDir || undefined
  });

  // The server echoes the sort it actually applied, so the header arrows show
  // the truth rather than what the URL happens to say.
  const activeSort = query.data?.sortBy ?? "occurredAt";
  const activeDir = query.data?.sortDir ?? "desc";

  function toggleSort(column: string) {
    const nextDir = activeSort === column && activeDir === "desc" ? "asc" : "desc";
    updateFilters({ sortBy: column, sortDir: nextDir });
  }

  return (
    <div className="space-y-6">
      <DashboardFilterBar
        startDate={filters.startDate}
        endDate={filters.endDate}
        interval={filters.interval}
        onRangeChange={(range) => updateFilters(range)}
        onIntervalChange={(interval) => updateFilters({ interval })}
        savedViewsPage="events"
        currentFilters={{
          startDate: filters.startDate,
          endDate: filters.endDate,
          eventType: filters.eventType || undefined,
          pageSize: filters.pageSize,
          sortBy: filters.sortBy || undefined,
          sortDir: (filters.sortDir || undefined) as "asc" | "desc" | undefined
        }}
        onApplySavedView={(saved) => updateFilters(saved)}
      />
      <Card className="flex justify-end">
        <EventFilters value={filters.eventType} onChange={(value) => updateFilters({ eventType: value })} />
      </Card>

      <QueryBoundary
        query={query}
        loadingLabel="Loading event log..."
        emptyMessage="No events match these filters."
        isEmpty={(data) => data.items.length === 0}
      >
        {(data) => (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)]">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[var(--surface-2)] text-[var(--muted)]">
                  <tr>
                    <SortableHeader
                      column="eventType"
                      label="Event type"
                      activeColumn={activeSort}
                      direction={activeDir}
                      onSort={toggleSort}
                    />
                    <SortableHeader
                      column="actorEmail"
                      label="Actor"
                      activeColumn={activeSort}
                      direction={activeDir}
                      onSort={toggleSort}
                    />
                    <th className="px-4 py-3">Entity</th>
                    <SortableHeader
                      column="occurredAt"
                      label="Occurred"
                      activeColumn={activeSort}
                      direction={activeDir}
                      onSort={toggleSort}
                    />
                    <th className="px-4 py-3">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.id} className="border-t border-[var(--border)]">
                      <td className="px-4 py-3">{row.eventType}</td>
                      <td className="px-4 py-3">{row.actorEmail ?? "Unknown"}</td>
                      <td className="px-4 py-3">{row.entityType ?? "n/a"}</td>
                      <td className="px-4 py-3">{new Date(row.occurredAt).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <Link to={`/events/${row.id}`} className="font-medium text-[var(--primary)]">
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              pageCount={data.pageCount}
              onPageChange={(page) => updateFilters({ page })}
              onPageSizeChange={(pageSize) => updateFilters({ pageSize })}
            />
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}
