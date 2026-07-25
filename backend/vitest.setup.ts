import { config } from "dotenv";

/**
 * Test environment bootstrap.
 *
 * Load order matters. This file runs before any test imports src/config/env.ts,
 * so whatever lands in process.env here wins: dotenv does not overwrite values
 * that are already set, and neither does the `??` chain below.
 *
 * That gives a clean precedence order:
 *   1. Real environment variables (what CI sets)
 *   2. backend/.env.test          (what a developer sets locally)
 *   3. The defaults below         (so a fresh clone still runs)
 *
 * Tests must never point at the development database — resetDatabase()
 * truncates every table, and losing your seed data mid-session is a miserable
 * way to learn that. Hence the separate `analytics_admin_test` default.
 */
config({ path: ".env.test" });

const TEST_DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/analytics_admin_test?schema=public";

process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.BACKEND_PORT = process.env.BACKEND_PORT ?? "4000";
process.env.FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";
process.env.API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:4000";
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.DIRECT_URL = process.env.DIRECT_URL ?? TEST_DATABASE_URL;
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret";
process.env.JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN ?? "15m";
process.env.JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN ?? "7d";
process.env.EXPORT_STORAGE_DIR = process.env.EXPORT_STORAGE_DIR ?? "storage/exports-test";

// The rate limiter is an in-memory bucket keyed by IP, and every test request
// arrives from the same loopback address. With the production default of 250
// requests/minute the RBAC suite alone (340+ requests) throttles itself and
// starts returning 429 instead of the status under test.
//
// Raising the ceiling here is the right call: rate limiting has its own
// dedicated tests that set the limit explicitly. It is also a live demonstration
// of why a process-local limiter is the wrong design — see US-18.
process.env.RATE_LIMIT_MAX_REQUESTS = process.env.RATE_LIMIT_MAX_REQUESTS ?? "1000000";

if (!/analytics_admin_test/.test(process.env.DATABASE_URL)) {
  throw new Error(
    `Refusing to run tests against "${process.env.DATABASE_URL}". ` +
      "The test database name must contain 'analytics_admin_test' because the " +
      "suite truncates every table between tests."
  );
}
