import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

import { useAuthStore, type AuthUser, type Role } from "../../auth/auth.store";

/**
 * Renders a component with everything the real app provides: a query client, a
 * router, and an authenticated session.
 *
 * Each call builds a *fresh* QueryClient. Sharing one across tests leaks cached
 * responses between them, which produces the worst kind of failure: a test that
 * passes alone and fails in a suite.
 */

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // No retries in tests. Otherwise asserting an error state means waiting
        // for the retry schedule to drain before the UI ever shows the error.
        retry: false,
        gcTime: 0,
        staleTime: 0
      },
      mutations: { retry: false }
    }
  });
}

export function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: overrides.id ?? "user-1",
    email: overrides.email ?? "test@example.com",
    firstName: overrides.firstName ?? "Test",
    lastName: overrides.lastName ?? "User",
    role: overrides.role ?? "SYSTEM_ADMIN"
  };
}

/** Puts a signed-in user into the zustand store, mirroring a real login. */
export function signIn(role: Role = "SYSTEM_ADMIN", overrides: Partial<AuthUser> = {}) {
  const user = makeUser({ ...overrides, role });
  useAuthStore.getState().setSession({
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
    user
  });
  return user;
}

export function signOut() {
  useAuthStore.getState().clearSession();
}

interface RenderWithProvidersOptions extends Omit<RenderOptions, "wrapper"> {
  /** Sign in as this role before rendering. Pass null to render signed out. */
  role?: Role | null;
  /** Initial history entries for the MemoryRouter. */
  initialEntries?: string[];
  queryClient?: QueryClient;
}

export function renderWithProviders(ui: ReactElement, options: RenderWithProvidersOptions = {}) {
  const { role = "SYSTEM_ADMIN", initialEntries = ["/"], queryClient, ...renderOptions } = options;

  if (role === null) {
    signOut();
  } else {
    signIn(role);
  }

  const client = queryClient ?? createTestQueryClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }

  return {
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
    queryClient: client
  };
}
