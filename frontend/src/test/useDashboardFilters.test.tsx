import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useSearchParams } from "react-router-dom";

import { useDashboardFilters } from "../features/dashboard/hooks/useDashboardFilters";

/** Renders the current filters and the raw query string for assertions. */
function Probe({ onReady }: { onReady: (api: ReturnType<typeof useDashboardFilters>) => void }) {
  const api = useDashboardFilters();
  const [searchParams] = useSearchParams();
  onReady(api);

  return (
    <div>
      <span data-testid="page">{api.filters.page}</span>
      <span data-testid="pageSize">{api.filters.pageSize}</span>
      <span data-testid="query">{searchParams.toString()}</span>
    </div>
  );
}

function setup(initialEntry: string) {
  let api!: ReturnType<typeof useDashboardFilters>;

  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/events"
          element={
            <Probe
              onReady={(value) => {
                api = value;
              }}
            />
          }
        />
      </Routes>
    </MemoryRouter>
  );

  return () => api;
}

describe("useDashboardFilters", () => {
  it("reads pagination and sorting from the URL", () => {
    setup("/events?page=3&pageSize=50&sortBy=eventType&sortDir=asc");

    expect(screen.getByTestId("page")).toHaveTextContent("3");
    expect(screen.getByTestId("pageSize")).toHaveTextContent("50");
  });

  it("falls back to sane defaults for junk values", () => {
    setup("/events?page=-4&pageSize=abc");

    expect(screen.getByTestId("page")).toHaveTextContent("1");
    expect(screen.getByTestId("pageSize")).toHaveTextContent("25");
  });

  /**
   * Narrowing the result set while sitting on page 40 lands the user on an
   * empty page, which reads as data loss.
   */
  it("resets to page 1 when a filter changes", () => {
    const getApi = setup("/events?page=7&eventType=API_ERROR");

    act(() => getApi().updateFilters({ eventType: "FEATURE_USED" }));

    expect(screen.getByTestId("page")).toHaveTextContent("1");
    expect(screen.getByTestId("query")).not.toHaveTextContent("page=7");
  });

  it("resets to page 1 when the sort changes", () => {
    const getApi = setup("/events?page=7");

    act(() => getApi().updateFilters({ sortBy: "eventType", sortDir: "asc" }));

    expect(screen.getByTestId("page")).toHaveTextContent("1");
  });

  it("does not reset when the page itself is being set", () => {
    const getApi = setup("/events?page=2");

    act(() => getApi().updateFilters({ page: 5 }));

    expect(screen.getByTestId("page")).toHaveTextContent("5");
  });

  it("removes a filter when set to an empty value", () => {
    const getApi = setup("/events?eventType=API_ERROR");

    act(() => getApi().updateFilters({ eventType: "" }));

    expect(screen.getByTestId("query")).not.toHaveTextContent("eventType");
  });
});
