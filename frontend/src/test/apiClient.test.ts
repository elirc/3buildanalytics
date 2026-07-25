import { ApiError, __resetRefreshStateForTests, apiClient } from "../api/client";
import { useAuthStore } from "../auth/auth.store";

/**
 * Exercises the 401 -> refresh -> replay path with a stubbed fetch.
 *
 * Nothing here talks to a real API; the point is the sequencing, which is where
 * the bugs live.
 */

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function session(accessToken: string) {
  return {
    accessToken,
    refreshToken: `refresh-for-${accessToken}`,
    user: {
      id: "u1",
      email: "test@example.com",
      firstName: "Test",
      lastName: "User",
      role: "SYSTEM_ADMIN" as const
    }
  };
}

beforeEach(() => {
  __resetRefreshStateForTests();
  useAuthStore.getState().setSession(session("expired-token"));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("apiClient token refresh", () => {
  it("refreshes and replays the original request after a 401", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);

      if (url.endsWith("/api/auth/refresh")) {
        return jsonResponse(session("fresh-token"));
      }
      // Fail while the stale token is in play, succeed once refreshed.
      const auth = new Headers(init?.headers).get("Authorization");
      if (auth === "Bearer expired-token") {
        return jsonResponse({ error: { code: "UNAUTHORIZED", message: "expired" } }, 401);
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    await expect(apiClient("/api/dashboard/kpi-summary")).resolves.toEqual({ ok: true });

    expect(calls).toEqual([
      "GET http://localhost:4000/api/dashboard/kpi-summary",
      "POST http://localhost:4000/api/auth/refresh",
      "GET http://localhost:4000/api/dashboard/kpi-summary"
    ]);
    expect(useAuthStore.getState().accessToken).toBe("fresh-token");
  });

  /**
   * The single-flight requirement. Refresh rotates the token, so concurrent
   * refreshes would revoke each other — and with reuse detection in place that
   * looks exactly like a replay attack and logs the user out.
   */
  it("issues exactly one refresh for many simultaneous 401s", async () => {
    let refreshCount = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/auth/refresh")) {
        refreshCount += 1;
        return jsonResponse(session("fresh-token"));
      }
      const auth = new Headers(init?.headers).get("Authorization");
      if (auth === "Bearer expired-token") {
        return jsonResponse({ error: { code: "UNAUTHORIZED", message: "expired" } }, 401);
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    await Promise.all(
      Array.from({ length: 10 }, (_, index) => apiClient(`/api/dashboard/widget-${index}`))
    );

    expect(refreshCount).toBe(1);
  });

  it("clears the session when the refresh itself fails", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/auth/refresh")) {
        return jsonResponse({ error: { code: "UNAUTHORIZED", message: "nope" } }, 401);
      }
      return jsonResponse({ error: { code: "UNAUTHORIZED", message: "expired" } }, 401);
    }) as typeof fetch;

    await expect(apiClient("/api/dashboard/kpi-summary")).rejects.toBeInstanceOf(ApiError);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it("does not try to refresh a failing refresh call", async () => {
    let refreshCount = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/auth/refresh")) {
        refreshCount += 1;
        return jsonResponse({ error: { code: "UNAUTHORIZED", message: "nope" } }, 401);
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    await expect(
      apiClient("/api/auth/refresh", { method: "POST", body: "{}" })
    ).rejects.toBeInstanceOf(ApiError);

    // Exactly one call: recursing here would loop forever.
    expect(refreshCount).toBe(1);
  });

  it("replays only once, so a persistent 401 surfaces instead of looping", async () => {
    let dataCalls = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/auth/refresh")) {
        return jsonResponse(session("fresh-token"));
      }
      dataCalls += 1;
      return jsonResponse({ error: { code: "UNAUTHORIZED", message: "still no" } }, 401);
    }) as typeof fetch;

    await expect(apiClient("/api/events")).rejects.toBeInstanceOf(ApiError);
    expect(dataCalls).toBe(2); // original + one replay
  });

  it("surfaces a non-401 error without attempting a refresh", async () => {
    let refreshCount = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/auth/refresh")) {
        refreshCount += 1;
      }
      return jsonResponse({ error: { code: "FORBIDDEN", message: "Insufficient permissions" } }, 403);
    }) as typeof fetch;

    await expect(apiClient("/api/exports")).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403
    });
    expect(refreshCount).toBe(0);
  });
});
