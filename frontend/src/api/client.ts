import { useAuthStore } from "../auth/auth.store";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * The error every API call rejects with.
 *
 * Carries the backend's machine-readable `code` and the HTTP status alongside
 * the message, so the UI can tell "you are not allowed to see this" from "the
 * server fell over" instead of showing the same raw string for both.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;

  constructor(input: { message: string; code: string; status: number; requestId?: string }) {
    super(input.message);
    this.name = "ApiError";
    this.code = input.code;
    this.status = input.status;
    this.requestId = input.requestId;
  }

  get isRetryable() {
    return this.status >= 500 || this.status === 0;
  }
}

/**
 * In-flight refresh, shared by every caller.
 *
 * A dashboard fires half a dozen queries at once. When the access token
 * expires they all get 401 at the same moment, and without this each would
 * start its own refresh. Since refresh *rotates* the token, the first to land
 * invalidates the rest — so concurrent refreshes would revoke each other and,
 * now that reuse detection exists, look exactly like a replay attack and log
 * everyone out.
 *
 * So: the first 401 starts the refresh, everyone else awaits the same promise.
 */
let refreshPromise: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  const { refreshToken, setSession, clearSession } = useAuthStore.getState();

  if (!refreshToken) {
    clearSession();
    return false;
  }

  const response = await fetch(`${API_URL}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken })
  });

  if (!response.ok) {
    clearSession();
    return false;
  }

  const session = (await response.json()) as Parameters<typeof setSession>[0];
  setSession(session);
  return true;
}

function refreshOnce() {
  if (!refreshPromise) {
    refreshPromise = refreshSession().finally(() => {
      // Cleared regardless of outcome so a later 401 can try again rather than
      // reusing a settled promise forever.
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

async function performFetch(path: string, init?: RequestInit) {
  const token = useAuthStore.getState().accessToken;
  const headers = new Headers(init?.headers);

  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(`${API_URL}${path}`, { ...init, headers });
}

export async function apiFetch(path: string, init?: RequestInit) {
  let response = await performFetch(path, init);

  // One refresh-and-replay attempt, never more. Retrying a second time would
  // loop forever against an endpoint that returns 401 for reasons unrelated to
  // token expiry.
  //
  // The refresh endpoint itself is excluded: if refreshing gives a 401 the
  // session is genuinely finished, and re-entering would recurse.
  if (response.status === 401 && !path.startsWith("/api/auth/refresh")) {
    const refreshed = await refreshOnce();

    if (refreshed) {
      response = await performFetch(path, init);
    }
    // On failure refreshSession() has already cleared the store. RequireAuth
    // watches that state, so the redirect to /login happens on the next render
    // — no imperative navigation needed here, and the API layer stays free of
    // router knowledge. LoginPage sends the user back where they were.
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string; code?: string; requestId?: string } }
      | null;

    throw new ApiError({
      message: payload?.error?.message ?? "Request failed",
      code: payload?.error?.code ?? codeFromStatus(response.status),
      status: response.status,
      requestId: payload?.error?.requestId
    });
  }

  return response;
}

function codeFromStatus(status: number) {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  return "INTERNAL_SERVER_ERROR";
}

export async function apiClient<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

/** Test-only: drop any in-flight refresh so suites cannot leak state. */
export function __resetRefreshStateForTests() {
  refreshPromise = null;
}
