import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { getDefaultDateRange } from "../../../lib/formatDate";

/**
 * Filter state lives in the URL, so any view is shareable by pasting a link and
 * the back button behaves the way people expect.
 *
 * Pagination and sorting are part of that state for the same reason: "the third
 * page of errors sorted oldest-first" is exactly the kind of thing someone
 * wants to send to a colleague.
 */

/** Filters whose change should send the user back to page 1. */
const PAGE_RESETTING_KEYS = ["startDate", "endDate", "interval", "eventType", "pageSize", "sortBy", "sortDir"];

export function useDashboardFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const defaults = getDefaultDateRange();

  const filters = useMemo(
    () => ({
      startDate: searchParams.get("startDate") ?? defaults.startDate,
      endDate: searchParams.get("endDate") ?? defaults.endDate,
      interval: searchParams.get("interval") ?? "day",
      eventType: searchParams.get("eventType") ?? "",
      page: toPositiveInt(searchParams.get("page"), 1),
      pageSize: toPositiveInt(searchParams.get("pageSize"), 25),
      sortBy: searchParams.get("sortBy") ?? "",
      sortDir: (searchParams.get("sortDir") as "asc" | "desc" | null) ?? "",
      compare: searchParams.get("compare") === "1"
    }),
    [defaults.endDate, defaults.startDate, searchParams]
  );

  function updateFilters(nextFilters: Partial<Record<keyof typeof filters, string | number>>) {
    const next = new URLSearchParams(searchParams);

    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") {
        next.delete(key);
      } else {
        next.set(key, String(value));
      }
    });

    // Narrowing the result set while sitting on page 40 lands the user on an
    // empty page and looks like data loss. Any change that reshapes the list
    // resets the cursor, unless the caller is explicitly setting the page.
    const changedKeys = Object.keys(nextFilters);
    const shouldResetPage =
      !changedKeys.includes("page") && changedKeys.some((key) => PAGE_RESETTING_KEYS.includes(key));

    if (shouldResetPage) {
      next.delete("page");
    }

    setSearchParams(next);
  }

  return { filters, updateFilters };
}

function toPositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
