import { getRedisClient } from "../../src/cache/redis.js";
import { prisma } from "../../src/db/prisma.js";

/**
 * Every table we own, in no particular order.
 *
 * TRUNCATE ... CASCADE ignores foreign-key ordering, so unlike a sequence of
 * deleteMany() calls this list does not have to be kept in dependency order.
 * It does have to be kept *complete* — a table missing here leaks rows between
 * tests, which shows up later as a confusing "why is this count wrong" failure.
 */
const TABLES = [
  "RefreshToken",
  "ExportJob",
  "DashboardConfig",
  "MetricSnapshot",
  "MonitoringMetric",
  "AuditEvent",
  "TrackedEvent",
  "User"
] as const;

/**
 * Wipe every table.
 *
 * One TRUNCATE is dramatically faster than eight DELETEs because it does not
 * scan rows or write per-row WAL entries. RESTART IDENTITY resets sequences so
 * tests that assert on generated values stay deterministic.
 */
export async function resetDatabase() {
  const list = TABLES.map((table) => `"${table}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
  await resetCache();
}

/**
 * Clears the Redis cache between tests.
 *
 * Truncating tables is not enough: cached responses survive, and cache keys are
 * built from role + date range, so two tests using the same range and role see
 * each other's results.
 *
 * This was found the hard way. Locally there is no Redis, so cacheService
 * always missed and the suite passed; CI *does* run Redis, so two
 * metric-snapshot tests read a cached "snapshot" response from an earlier test
 * and failed asserting "live". A difference between the local and CI
 * environments was hiding a genuine state leak — which is a good argument for
 * CI running the real dependencies.
 *
 * Failure is ignored: the suite must still run without Redis.
 */
export async function resetCache() {
  try {
    await getRedisClient().flushdb();
  } catch {
    // No Redis available — nothing cached, nothing to clear.
  }
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
}

export { prisma };
