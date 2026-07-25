import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  createSavedView,
  deleteSavedView,
  getSavedViews,
  type SavedView,
  type SavedViewFilters,
  type SavedViewPage
} from "../../../api/savedViews.api";
import { useAuthStore } from "../../../auth/auth.store";
import { hasPermission } from "../../../lib/permissions";

/**
 * Saves and restores a page's filter set.
 *
 * Applying a view just writes its filters back into the URL — everything else
 * on the page already reacts to that, so no component needs to know saved views
 * exist.
 */
export function SavedViewsMenu({
  page,
  currentFilters,
  onApply
}: {
  page: SavedViewPage;
  currentFilters: SavedViewFilters;
  onApply: (filters: SavedViewFilters) => void;
}) {
  const role = useAuthStore((state) => state.user?.role);
  const granted = useAuthStore((state) => state.user?.permissions);
  const userId = useAuthStore((state) => state.user?.id);
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [isNaming, setIsNaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManage = hasPermission(role, "views:manage", granted);

  const viewsQuery = useQuery({
    queryKey: ["saved-views", page],
    queryFn: () => getSavedViews(page),
    enabled: canManage
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["saved-views", page] });

  const createMutation = useMutation({
    mutationFn: createSavedView,
    onSuccess: () => {
      setName("");
      setIsNaming(false);
      setError(null);
      invalidate();
    },
    onError: (mutationError: Error) => setError(mutationError.message)
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSavedView,
    onSuccess: invalidate
  });

  // Read-only users cannot save views, so the control is hidden rather than
  // shown-and-then-refused.
  if (!canManage) {
    return null;
  }

  const views = viewsQuery.data ?? [];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Saved views"
        value=""
        onChange={(event) => {
          const selected = views.find((view: SavedView) => view.id === event.target.value);
          if (selected) {
            onApply(selected.filtersJson);
          }
        }}
        className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm"
      >
        <option value="">Saved views…</option>
        {views.map((view: SavedView) => (
          <option key={view.id} value={view.id}>
            {view.name}
            {view.ownerId !== userId ? ` (${view.owner.email})` : ""}
          </option>
        ))}
      </select>

      {isNaming ? (
        <>
          <input
            aria-label="View name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name this view"
            className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm"
          />
          <button
            type="button"
            disabled={!name.trim() || createMutation.isPending}
            onClick={() =>
              createMutation.mutate({ name: name.trim(), page, filtersJson: currentFilters })
            }
            className="rounded-2xl bg-[var(--primary)] px-4 py-3 text-sm font-medium text-white disabled:opacity-40"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setIsNaming(false);
              setError(null);
            }}
            className="rounded-2xl border border-[var(--border)] px-4 py-3 text-sm"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setIsNaming(true)}
          className="rounded-2xl border border-[var(--border)] px-4 py-3 text-sm font-medium"
        >
          Save current view
        </button>
      )}

      {views.some((view: SavedView) => view.ownerId === userId) ? (
        <select
          aria-label="Delete a saved view"
          value=""
          onChange={(event) => {
            if (event.target.value) {
              deleteMutation.mutate(event.target.value);
            }
          }}
          className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm"
        >
          <option value="">Delete…</option>
          {views
            .filter((view: SavedView) => view.ownerId === userId)
            .map((view: SavedView) => (
              <option key={view.id} value={view.id}>
                {view.name}
              </option>
            ))}
        </select>
      ) : null}

      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
