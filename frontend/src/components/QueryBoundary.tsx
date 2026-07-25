import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";

/**
 * Renders the four states a query can be in: pending, error, empty, and data.
 *
 * Pages used to write `{query.data ? <Table/> : <LoadingState/>}`, which checks
 * data truthiness rather than query status. On a 403 or a dead API, `data`
 * stays undefined forever and the user watched "Loading..." indefinitely, with
 * no error, no retry, and no clue.
 *
 * The children prop is a function so that by the time it runs, data is
 * non-nullable — the component cannot be used in a way that reintroduces the
 * optional-chaining soup it replaces.
 */
export function QueryBoundary<TData>({
  query,
  children,
  loadingLabel,
  emptyMessage = "No data for the selected range.",
  isEmpty
}: {
  query: UseQueryResult<TData>;
  children: (data: TData) => ReactNode;
  loadingLabel?: string;
  emptyMessage?: string;
  /** Override for shapes where emptiness is not just an empty array. */
  isEmpty?: (data: TData) => boolean;
}) {
  if (query.isPending) {
    return <LoadingState label={loadingLabel} />;
  }

  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  const data = query.data as TData;

  if (isEmpty ? isEmpty(data) : Array.isArray(data) && data.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return <>{children(data)}</>;
}
