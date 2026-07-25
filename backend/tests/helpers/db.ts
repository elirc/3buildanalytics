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
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
}

export { prisma };
