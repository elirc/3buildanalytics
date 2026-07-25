import { apiClient } from "./client";

export type SavedViewPage =
  | "operations"
  | "product"
  | "engineering"
  | "executive"
  | "events"
  | "audit";

export interface SavedViewFilters {
  startDate?: string;
  endDate?: string;
  interval?: "day" | "week";
  eventType?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export interface SavedView {
  id: string;
  name: string;
  page: SavedViewPage;
  filtersJson: SavedViewFilters;
  isShared: boolean;
  ownerId: string;
  owner: { id: string; email: string; firstName: string; lastName: string };
  createdAt: string;
  updatedAt: string;
}

export function getSavedViews(page: SavedViewPage) {
  return apiClient<SavedView[]>(`/api/saved-views?page=${encodeURIComponent(page)}`);
}

export function createSavedView(payload: {
  name: string;
  page: SavedViewPage;
  filtersJson: SavedViewFilters;
  isShared?: boolean;
}) {
  return apiClient<SavedView>("/api/saved-views", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateSavedView(
  id: string,
  payload: { name?: string; filtersJson?: SavedViewFilters; isShared?: boolean }
) {
  return apiClient<SavedView>(`/api/saved-views/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function deleteSavedView(id: string) {
  return apiClient<void>(`/api/saved-views/${id}`, { method: "DELETE" });
}
