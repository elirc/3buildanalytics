import { PrismaClient } from "@prisma/client";

/**
 * The single PrismaClient.
 *
 * Query timings are measured with a client extension so DB_QUERY_TIME reflects
 * this application's real database behaviour rather than a seeded constant.
 *
 * The import of the collector is deferred to call time. prisma.ts sits near the
 * bottom of the dependency graph and the collector imports prisma (it writes
 * metric rows); importing it eagerly here would be a cycle. Resolving it lazily
 * costs one module-cache lookup per query and keeps the graph acyclic.
 */
export const prisma = new PrismaClient().$extends({
  query: {
    async $allOperations({ args, query }) {
      const startedAt = performance.now();

      try {
        return await query(args);
      } finally {
        const durationMs = performance.now() - startedAt;

        try {
          const { metricsCollector } = await import("../shared/metrics/collector.js");
          metricsCollector.recordDbQuery(durationMs);
        } catch {
          // Measuring must never be able to fail the query it measured.
        }
      }
    }
  }
}) as unknown as PrismaClient;
