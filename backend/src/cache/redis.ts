import { Redis } from "ioredis";

import { env } from "../config/env.js";

let redisClient: Redis | null = null;

/**
 * The cache connection.
 *
 * This client is for caching only. BullMQ builds its own connections in
 * jobs/queue.ts and jobs/export.processor.ts, and those genuinely do need
 * `maxRetriesPerRequest: null` because a blocking BRPOPLPUSH must never be
 * abandoned. Cache reads are the opposite: if Redis is slow or gone we want to
 * find out immediately and fall back to querying the database.
 *
 * The previous configuration used `maxRetriesPerRequest: null` here too, which
 * makes ioredis queue commands indefinitely while disconnected. `cacheService`
 * wraps every call in try/catch, so it *looks* fault tolerant — but the promise
 * never settles, so the catch never runs and the request hangs until the client
 * gives up. With Redis stopped, every cached dashboard endpoint hung rather than
 * degrading, contradicting the "Redis is optional" behaviour that server.ts
 * advertises by catching connection failures at boot.
 */
export function getRedisClient() {
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      // Fail the command instead of parking it in the offline queue forever.
      enableOfflineQueue: false,
      // One retry, then surface the error so cacheService can fall through.
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000,
      commandTimeout: 1_000,
      // Cap reconnect backoff; without this a long outage pushes the delay high
      // enough that recovery looks like a permanent failure.
      retryStrategy: (attempt) => Math.min(attempt * 200, 2_000)
    });

    // An 'error' event with no listener is an unhandled exception in Node and
    // would crash the process the moment Redis became unreachable.
    redisClient.on("error", () => {
      // Intentionally swallowed. cacheService reports failures per operation;
      // logging every reconnect attempt here would flood the logs during an outage.
    });
  }

  return redisClient;
}

/** Used by tests and shutdown paths so an open handle cannot keep the process alive. */
export async function disconnectRedis() {
  if (redisClient) {
    redisClient.disconnect();
    redisClient = null;
  }
}
