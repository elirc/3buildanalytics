import { useAuthStore } from "../auth/auth.store";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * The error every API call rejects with.
 *
 * Carries the backend's machine-readable `code` and the HTTP status alongside
 * the message. Previously only the message survived, so the UI could not tell
 * "you are not allowed to see this" from "the server fell over" and showed the
 * same raw string for both.
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

  /** True when retrying without changing anything could plausibly work. */
  get isRetryable() {
    return this.status >= 500 || this.status === 0;
  }
}

export async function apiFetch(path: string, init?: RequestInit) {
  const token = useAuthStore.getState().accessToken;
  const headers = new Headers(init?.headers);

  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string; code?: string; requestId?: string } }
      | null;

    throw new ApiError({
      message: payload?.error?.message ?? "Request failed",
      // Fall back to a status-derived code so a non-JSON failure (a proxy error
      // page, say) still produces something the UI can branch on.
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
