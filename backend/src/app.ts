import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";

import { getRedisClient } from "./cache/redis.js";
import { env } from "./config/env.js";
import { prisma } from "./db/prisma.js";
import { authMiddleware } from "./middleware/auth.middleware.js";
import { errorMiddleware } from "./middleware/error.middleware.js";
import { rateLimitMiddleware } from "./middleware/rateLimit.middleware.js";
import { requestLoggerMiddleware } from "./middleware/requestLogger.middleware.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";
import { eventsRouter } from "./modules/events/events.routes.js";
import { auditRouter } from "./modules/audit/audit.routes.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import { monitoringRouter } from "./modules/monitoring/monitoring.routes.js";
import { exportsRouter } from "./modules/exports/exports.routes.js";
import { dashboardConfigsRouter } from "./modules/dashboardConfigs/dashboardConfigs.routes.js";
import { savedViewsRouter } from "./modules/savedViews/savedViews.routes.js";
import { alertsRouter } from "./modules/alerts/alerts.routes.js";

/** SELECT 1 â€” cheap, and proves the pool can actually hand out a connection. */
async function checkDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown" };
  }
}

async function checkRedis() {
  try {
    await getRedisClient().ping();
    return { ok: true };
  } catch (error) {
    // Reported, not fatal: the app degrades without Redis by design.
    return { ok: false, error: error instanceof Error ? error.message : "unknown" };
  }
}

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: env.FRONTEND_URL
    })
  );
  app.use(helmet());
  app.use(express.json());
  app.use(cookieParser());
  app.use(requestLoggerMiddleware);
  // authMiddleware runs BEFORE the limiter now. It is non-blocking — it only
  // attaches req.user when a valid token is present — so moving it earlier
  // changes no authorisation behaviour, and it lets the limiter key on the
  // user instead of the IP. Without that, everyone behind one office NAT
  // shares a single budget.
  app.use(authMiddleware);
  app.use(rateLimitMiddleware);

  /** Liveness: the process is up and can answer. Deliberately checks nothing else. */
  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  /**
   * Readiness: can this instance actually serve traffic?
   *
   * This used to return `{ status: "ready" }` unconditionally, which makes it
   * useless as a readiness probe â€” an instance with no database would report
   * ready and then fail every request routed to it.
   *
   * Postgres is required; Redis is not, because the app is designed to degrade
   * without it. So a missing Redis is reported but does not fail the check,
   * while a missing database returns 503 and takes the instance out of
   * rotation.
   */
  app.get("/health/ready", async (_request, response) => {
    const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);

    const ready = database.ok;

    response.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      checks: { database, redis }
    });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/events", eventsRouter);
  app.use("/api/audit-events", auditRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/monitoring", monitoringRouter);
  app.use("/api/exports", exportsRouter);
  app.use("/api/dashboard-configs", dashboardConfigsRouter);
  app.use("/api/saved-views", savedViewsRouter);
  app.use("/api/alerts", alertsRouter);

  app.use(errorMiddleware);

  return app;
}
