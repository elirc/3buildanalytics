import { Queue } from "bullmq";

import { env } from "../config/env.js";
import { logWarn } from "../shared/utils/logger.js";

let exportQueue: Queue | null = null;

export function getExportQueue() {
  if (!exportQueue) {
    exportQueue = new Queue("exports", {
      connection: {
        url: env.REDIS_URL
      }
    });
  }

  return exportQueue;
}

export interface QueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: number;
}

/**
 * Counts straight from BullMQ.
 *
 * Returns null when Redis is unreachable rather than throwing, because a
 * monitoring page must not go down because the thing it monitors is down —
 * that is precisely when someone is looking at it.
 */
/** How long we will wait for the queue before deciding it is unavailable. */
const QUEUE_READ_TIMEOUT_MS = 1_500;

/**
 * Rejects if `operation` has not settled in time.
 *
 * BullMQ's connection keeps its own retry policy, and with Redis unreachable a
 * command *waits* rather than failing — so a try/catch around it never runs and
 * the request hangs until the client gives up. The same trap as the cache
 * client in US-20, in a place where the client options cannot simply be
 * loosened: BullMQ needs its own retry semantics to work correctly.
 *
 * Bounding the operation we care about is the fix that does not depend on
 * someone else's timeout configuration.
 */
function withTimeout<T>(operation: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Queue read timed out after ${ms}ms`)), ms);

    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function getQueueCounts(): Promise<QueueCounts | null> {
  try {
    const counts = await withTimeout(
      getExportQueue().getJobCounts(
        "waiting",
        "active",
        "delayed",
        "failed",
        "completed",
        "paused"
      ),
      QUEUE_READ_TIMEOUT_MS
    );

    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
      completed: counts.completed ?? 0,
      paused: counts.paused ?? 0
    };
  } catch (error) {
    logWarn("queue.counts.unavailable", {
      error: error instanceof Error ? error.message : "unknown"
    });
    return null;
  }
}
