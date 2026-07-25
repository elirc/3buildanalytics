import { cacheService } from "./cache.service.js";

/**
 * Drops cached aggregates when the data behind them changes.
 *
 * Before this, the only way to see a newly recorded event on a dashboard was to
 * wait out the 300s TTL. Recording something and not seeing it is
 * indistinguishable, to a user, from it not having been recorded.
 *
 * Prefix-based rather than surgical on purpose: an aggregate depends on a date
 * range and a role, so working out exactly which cached entries a single new
 * event affects costs more than recomputing them. Dropping the family is
 * cheaper and cannot be subtly wrong.
 *
 * Every call is fire-and-forget from the caller's perspective: invalidation
 * runs after the write has committed and its failure must never fail the
 * request, because the TTL is still there as a backstop.
 */
export const cacheInvalidator = {
  async onTrackedEvent() {
    await cacheService.delByPrefix("dashboard:");
  },

  async onAuditEvent() {
    await cacheService.delByPrefix("audit:");
  },

  async onMonitoringMetric() {
    await cacheService.delByPrefix("monitoring:");
  }
};
