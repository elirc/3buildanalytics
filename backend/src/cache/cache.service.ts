import { getRedisClient } from "./redis.js";
import { logWarn } from "../shared/utils/logger.js";

/**
 * Cache hit/miss counters.
 *
 * Kept in memory and read by the monitoring metrics collector. Process-local,
 * which is fine for a rate: each instance reports its own, and averaging them
 * is the correct aggregation anyway.
 */
const counters = { hits: 0, misses: 0 };

export const cacheService = {
  async get<T>(key: string) {
    try {
      const raw = await getRedisClient().get(key);

      if (raw) {
        counters.hits += 1;
        return JSON.parse(raw) as T;
      }

      counters.misses += 1;
      return null;
    } catch (error) {
      // A cache failure is a miss, not an error — but it is worth knowing about.
      // Previously this was swallowed in total silence, so a broken Redis was
      // indistinguishable from a cold one.
      counters.misses += 1;
      logWarn("cache.get.failed", { key, error: error instanceof Error ? error.message : "unknown" });
      return null;
    }
  },

  async set(key: string, value: unknown, ttlSeconds: number) {
    try {
      await getRedisClient().set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch (error) {
      logWarn("cache.set.failed", { key, error: error instanceof Error ? error.message : "unknown" });
      return null;
    }
  },

  async del(key: string) {
    try {
      await getRedisClient().unlink(key);
    } catch (error) {
      logWarn("cache.del.failed", { key, error: error instanceof Error ? error.message : "unknown" });
    }
  },

  /**
   * Deletes every key under a prefix.
   *
   * Uses SCAN, never KEYS. KEYS blocks the Redis event loop for the duration of
   * the scan, which on a large keyspace stalls every other client — a
   * cache-clearing operation that takes the cache down is not an improvement.
   *
   * UNLINK rather than DEL so the reclaim happens on a background thread.
   */
  async delByPrefix(prefix: string) {
    try {
      const client = getRedisClient();
      let cursor = "0";
      let deleted = 0;

      do {
        const [nextCursor, keys] = await client.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100);
        cursor = nextCursor;

        if (keys.length > 0) {
          await client.unlink(...keys);
          deleted += keys.length;
        }
      } while (cursor !== "0");

      return deleted;
    } catch (error) {
      logWarn("cache.del_by_prefix.failed", {
        prefix,
        error: error instanceof Error ? error.message : "unknown"
      });
      return 0;
    }
  },

  /** Snapshot of hit/miss counters; resets them so each read covers one window. */
  drainCounters() {
    const snapshot = { ...counters };
    counters.hits = 0;
    counters.misses = 0;
    return snapshot;
  },

  peekCounters() {
    return { ...counters };
  }
};
