import { Role } from "@prisma/client";
import request from "supertest";

import { createApp } from "../../src/app.js";
import { hasPermission, type Permission } from "../../src/shared/permissions.js";
import { authHeaderFor, invalidAuthHeader } from "../helpers/auth.js";
import { createUserPerRole } from "../helpers/factories.js";
import { disconnectDatabase, resetDatabase } from "../helpers/db.js";

/**
 * The RBAC contract.
 *
 * This is the highest-value test in the suite. It asserts, for every mounted
 * route and every role, that access matches the permission matrix — nothing
 * else. It does not care what the endpoints return.
 *
 * Why a hand-maintained table instead of introspecting the Express router?
 * Because the table is the *specification*. If someone adds a route and forgets
 * to add it here, the completeness check at the bottom fails. If someone
 * removes a requirePermission() call, the per-role assertions fail. Deriving
 * the table from the router would make the test agree with the code by
 * construction, which is exactly the bug we are trying to catch.
 *
 * Assertion shape: a permitted role must not be rejected (we allow 200/400/404
 * — a validation error still proves authorization passed), a non-permitted role
 * must get exactly 403, and an anonymous caller must get 401.
 */

type RouteSpec = {
  method: "get" | "post" | "patch" | "delete";
  path: string;
  /** null = public (no auth at all), "AUTHENTICATED" = any logged-in user */
  permission: Permission | null | "AUTHENTICATED";
};

const ROUTES: RouteSpec[] = [
  // auth — public by design
  { method: "post", path: "/api/auth/register", permission: null },
  { method: "post", path: "/api/auth/login", permission: null },
  { method: "post", path: "/api/auth/refresh", permission: null },
  { method: "post", path: "/api/auth/logout", permission: null },
  { method: "post", path: "/api/auth/logout-all", permission: "AUTHENTICATED" },
  { method: "get", path: "/api/auth/me", permission: "AUTHENTICATED" },
  // Any signed-in user may read their own permission list — it tells them
  // nothing they could not learn by clicking around, and the UI needs it.
  { method: "get", path: "/api/auth/permissions", permission: "AUTHENTICATED" },

  // users
  { method: "get", path: "/api/users", permission: "users:manage" },

  // events
  { method: "post", path: "/api/events/track", permission: "events:view" },
  { method: "get", path: "/api/events", permission: "events:view" },
  { method: "get", path: "/api/events/summary/by-type", permission: "events:view" },
  { method: "get", path: "/api/events/summary/over-time", permission: "events:view" },
  { method: "get", path: "/api/events/some-id", permission: "events:view" },

  // audit
  { method: "get", path: "/api/audit-events", permission: "audit:view" },
  { method: "get", path: "/api/audit-events/summary/by-action", permission: "audit:view" },
  { method: "get", path: "/api/audit-events/summary/by-actor", permission: "audit:view" },
  { method: "get", path: "/api/audit-events/summary/over-time", permission: "audit:view" },
  { method: "get", path: "/api/audit-events/some-id", permission: "audit:view" },

  // dashboard
  { method: "get", path: "/api/dashboard/kpi-summary", permission: "dashboard:view" },
  { method: "get", path: "/api/dashboard/events-over-time", permission: "dashboard:view" },
  { method: "get", path: "/api/dashboard/events-by-type", permission: "dashboard:view" },
  { method: "get", path: "/api/dashboard/active-users", permission: "dashboard:view" },
  { method: "get", path: "/api/dashboard/error-rate", permission: "dashboard:view" },
  { method: "get", path: "/api/dashboard/conversion-funnel", permission: "dashboard:view" },
  { method: "get", path: "/api/dashboard/recent-activity", permission: "dashboard:view" },

  // monitoring
  { method: "post", path: "/api/monitoring/metrics", permission: "monitoring:view" },
  { method: "get", path: "/api/monitoring/summary", permission: "monitoring:view" },
  { method: "get", path: "/api/monitoring/api-latency", permission: "monitoring:view" },
  { method: "get", path: "/api/monitoring/error-rate", permission: "monitoring:view" },
  { method: "get", path: "/api/monitoring/job-failures", permission: "monitoring:view" },
  { method: "get", path: "/api/monitoring/cache-hit-rate", permission: "monitoring:view" },
  { method: "get", path: "/api/monitoring/db-query-time", permission: "monitoring:view" },
  { method: "get", path: "/api/monitoring/queue-depth", permission: "monitoring:view" },
  { method: "get", path: "/api/monitoring/recent-job-failures", permission: "monitoring:view" },

  // exports
  { method: "post", path: "/api/exports", permission: "exports:create" },
  { method: "get", path: "/api/exports", permission: "exports:view" },
  { method: "get", path: "/api/exports/some-id", permission: "exports:view" },
  { method: "get", path: "/api/exports/some-id/download", permission: "exports:view" },
  { method: "post", path: "/api/exports/some-id/retry", permission: "exports:create" },

  // dashboard configs
  { method: "get", path: "/api/dashboard-configs", permission: "dashboard:configure" },
  { method: "post", path: "/api/dashboard-configs", permission: "dashboard:configure" },
  { method: "get", path: "/api/dashboard-configs/some-id", permission: "dashboard:configure" },
  { method: "patch", path: "/api/dashboard-configs/some-id", permission: "dashboard:configure" },
  { method: "delete", path: "/api/dashboard-configs/some-id", permission: "dashboard:configure" },

  // saved views
  { method: "get", path: "/api/saved-views", permission: "views:manage" },
  { method: "post", path: "/api/saved-views", permission: "views:manage" },
  { method: "patch", path: "/api/saved-views/some-id", permission: "views:manage" },
  { method: "delete", path: "/api/saved-views/some-id", permission: "views:manage" }
];

const ALL_ROLES = Object.values(Role);
const app = createApp();

/** Routes that require authentication of some kind. */
const guardedRoutes = ROUTES.filter((route) => route.permission !== null);

let users: Record<Role, { id: string; email: string; role: Role }>;

beforeAll(async () => {
  await resetDatabase();
  users = await createUserPerRole(ALL_ROLES);
});

afterAll(async () => {
  await resetDatabase();
  await disconnectDatabase();
});

function send(route: RouteSpec, headers: Record<string, string>) {
  return request(app)[route.method](route.path).set(headers).send({});
}

describe("RBAC contract", () => {
  describe("anonymous callers", () => {
    it.each(guardedRoutes.map((route) => [`${route.method.toUpperCase()} ${route.path}`, route]))(
      "%s rejects an anonymous request with 401",
      async (_label, route) => {
        const response = await request(app)[(route as RouteSpec).method]((route as RouteSpec).path).send({});
        expect(response.status).toBe(401);
      }
    );

    it.each(guardedRoutes.map((route) => [`${route.method.toUpperCase()} ${route.path}`, route]))(
      "%s rejects a token signed with the wrong secret with 401",
      async (_label, route) => {
        const response = await send(route as RouteSpec, invalidAuthHeader());
        expect(response.status).toBe(401);
      }
    );
  });

  describe.each(ALL_ROLES)("role %s", (role) => {
    it.each(guardedRoutes.map((route) => [`${route.method.toUpperCase()} ${route.path}`, route]))(
      "%s matches the permission matrix",
      async (_label, routeInput) => {
        const route = routeInput as RouteSpec;
        const response = await send(route, authHeaderFor(users[role]));

        const allowed =
          route.permission === "AUTHENTICATED" ||
          hasPermission(role, route.permission as Permission);

        if (allowed) {
          // 400/404/500 are all fine here — they prove we got *past* authorization.
          // What must never happen is an authentication or authorization rejection.
          expect(response.status).not.toBe(401);
          expect(response.status).not.toBe(403);
        } else {
          expect(response.status).toBe(403);
          expect(response.body.error?.code).toBe("FORBIDDEN");
        }
      }
    );
  });

  it("covers every route mounted on the app", () => {
    // Adding a route to the app without adding it to ROUTES fails this test.
    //
    // Express 5 does not expose mount prefixes (a sub-router layer carries
    // matcher *functions*, not a readable path), so we cannot rebuild absolute
    // URLs from the layer stack. What we can read is each sub-router's own
    // route paths. So we compare method+suffix pairs as a multiset: every
    // mounted "GET /:id" must be matched by a declared one somewhere.
    const mounted = collectMountedRouteSuffixes(app);
    const declared = ROUTES.map((route) => `${route.method.toUpperCase()} ${toSuffix(route.path)}`).sort();

    expect(mounted).toEqual(declared);
  });
});

/** Mount prefixes, longest first so "/api/dashboard-configs" wins over "/api/dashboard". */
const MOUNT_PREFIXES = [
  "/api/dashboard-configs",
  "/api/saved-views",
  "/api/audit-events",
  "/api/monitoring",
  "/api/dashboard",
  "/api/exports",
  "/api/events",
  "/api/users",
  "/api/auth"
].sort((left, right) => right.length - left.length);

/** "/api/exports/some-id/download" -> "/:id/download" */
function toSuffix(path: string) {
  const prefix = MOUNT_PREFIXES.find((candidate) => path.startsWith(candidate));
  const suffix = prefix ? path.slice(prefix.length) : path;
  return (suffix || "/").replace(/\/some-id\b/g, "/:id");
}

type LayerLike = {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: LayerLike[] };
};

function collectMountedRouteSuffixes(expressApp: ReturnType<typeof createApp>): string[] {
  const found: string[] = [];

  const walk = (stack: LayerLike[]) => {
    for (const layer of stack) {
      if (layer.route) {
        // /health and /health/ready are intentionally public and unguarded.
        if (layer.route.path.startsWith("/health")) {
          continue;
        }
        for (const [method, enabled] of Object.entries(layer.route.methods)) {
          if (enabled) {
            found.push(`${method.toUpperCase()} ${layer.route.path}`);
          }
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };

  const internals = expressApp as unknown as {
    router?: { stack: LayerLike[] };
    _router?: { stack: LayerLike[] };
  };
  walk(internals.router?.stack ?? internals._router?.stack ?? []);

  return found.sort();
}
