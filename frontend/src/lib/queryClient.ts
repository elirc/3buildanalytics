import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      // Never retry a rate limit — retrying is exactly what produced it, and
      // TanStack's default backoff would keep the client hammering an endpoint
      // that has already said no.
      retry: (failureCount, error) => {
        const code = (error as { code?: string } | null)?.code;
        if (code === "RATE_LIMITED" || code === "FORBIDDEN" || code === "UNAUTHORIZED") {
          return false;
        }
        return failureCount < 1;
      },
      refetchOnWindowFocus: false
    }
  }
});
