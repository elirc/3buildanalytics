import { useQuery } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { ApiError } from "../api/client";
import { QueryBoundary } from "../components/QueryBoundary";
import { renderWithProviders } from "./helpers/renderWithProviders";

/** Drives QueryBoundary with a caller-supplied query function. */
function Harness({ queryFn, key }: { queryFn: () => Promise<unknown>; key: string }) {
  const query = useQuery({ queryKey: [key], queryFn });

  return (
    <QueryBoundary query={query} loadingLabel="Loading things...">
      {(data) => <p>loaded: {JSON.stringify(data)}</p>}
    </QueryBoundary>
  );
}

describe("QueryBoundary", () => {
  it("shows the loading label while pending", () => {
    renderWithProviders(<Harness key="pending" queryFn={() => new Promise(() => {})} />);
    expect(screen.getByText("Loading things...")).toBeInTheDocument();
  });

  it("shows the data once resolved", async () => {
    renderWithProviders(<Harness key="ok" queryFn={async () => ({ a: 1 })} />);
    expect(await screen.findByText(/loaded/)).toBeInTheDocument();
  });

  it("shows an empty state for an empty array", async () => {
    renderWithProviders(<Harness key="empty" queryFn={async () => []} />);
    expect(await screen.findByText(/no data for the selected range/i)).toBeInTheDocument();
  });

  /**
   * The regression this story exists to fix: pages checked `data` truthiness,
   * so an error left them showing a spinner forever.
   */
  it("shows an error instead of spinning forever when the query rejects", async () => {
    renderWithProviders(
      <Harness
        key="boom"
        queryFn={async () => {
          throw new ApiError({ message: "kaboom", code: "INTERNAL_SERVER_ERROR", status: 500 });
        }}
      />
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Loading things...")).not.toBeInTheDocument();
  });

  it("refetches when Try again is clicked", async () => {
    let calls = 0;
    const queryFn = async () => {
      calls += 1;
      if (calls === 1) {
        throw new ApiError({ message: "temporary", code: "INTERNAL_SERVER_ERROR", status: 500 });
      }
      return { ok: true };
    };

    renderWithProviders(<Harness key="retry" queryFn={queryFn} />);

    const retry = await screen.findByRole("button", { name: /try again/i });
    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByText(/loaded/)).toBeInTheDocument());
    expect(calls).toBe(2);
  });

  it("explains a 403 and does not offer a pointless retry", async () => {
    renderWithProviders(
      <Harness
        key="forbidden"
        queryFn={async () => {
          throw new ApiError({ message: "Insufficient permissions", code: "FORBIDDEN", status: 403 });
        }}
      />
    );

    expect(await screen.findByText(/don't have access/i)).toBeInTheDocument();
    // A permission failure is an answer, not a transient fault. Offering a
    // retry button here just teaches people to mash it.
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });
});
