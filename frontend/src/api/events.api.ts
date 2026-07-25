import { apiClient } from "./client";
import type { DateRangeParams } from "./dashboard.api";

export interface EventRow {
  id: string;
  eventType: string;
  entityType: string | null;
  entityId: string | null;
  actorEmail: string | null;
  occurredAt: string;
  metadata?: Record<string, unknown> | null;
}

export interface PagedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  /** Sent by the server so the client never has to recompute it. */
  pageCount: number;
  sortBy: string;
  sortDir: "asc" | "desc";
}

export type EventSortColumn = "occurredAt" | "eventType" | "actorEmail";

export function getEvents(
  params: DateRangeParams & {
    eventType?: string;
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortDir?: string;
  }
) {
  const query = new URLSearchParams(
    Object.entries(params).reduce<Record<string, string>>((accumulator, [key, value]) => {
      // Empty strings would be sent as `sortBy=` and rejected by the allowlist,
      // so they are dropped alongside undefined.
      if (value !== undefined && value !== "") accumulator[key] = String(value);
      return accumulator;
    }, {})
  ).toString();

  return apiClient<PagedResponse<EventRow>>(`/api/events?${query}`);
}

export function getEventById(id: string) {
  return apiClient<EventRow>(`/api/events/${id}`);
}
