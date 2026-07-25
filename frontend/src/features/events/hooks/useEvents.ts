import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { getEvents } from "../../../api/events.api";

export function useEvents(params: {
  startDate: string;
  endDate: string;
  eventType?: string;
  page: number;
  pageSize: number;
  sortBy?: string;
  sortDir?: string;
}) {
  return useQuery({
    // Every input that changes the result belongs in the key. Miss one and the
    // UI shows a cached page from a different filter set.
    queryKey: [
      "events",
      params.startDate,
      params.endDate,
      params.eventType,
      params.page,
      params.pageSize,
      params.sortBy,
      params.sortDir
    ],
    queryFn: () => getEvents(params),
    // Keeps the current page visible while the next one loads, instead of
    // flashing a spinner and collapsing the table height on every click.
    placeholderData: keepPreviousData
  });
}
