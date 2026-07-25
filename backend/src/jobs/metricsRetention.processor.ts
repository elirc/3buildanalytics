import { Queue, Worker } from "bullmq";

import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { logError, logInfo } from "../shared/utils/logger.js";

const QUEUE_NAME = "metrics-retention";
const REPEAT_JOB_NAME = "PRUNE_OLD_METRICS";

let worker: Worker | null = null;
let queue: Queue | null = null;

/**
 * Deletes MonitoringMetric rows past the retention window.
 *
 * This table grows faster than any other now that the app measures itself —
 * a row per request, plus derived rows per flush. Without pruning it would
 * become the largest table in the database within weeks, and the charts only
 * ever read the recent past.
 *
 * Daily at 04:00, an hour after the snapshot rollup, so the two never contend
 * for the same connections.
 */
export async function registerMetricsRetentionProcessor() {
  if (worker) {
    return worker;
  }

  queue = new Queue(QUEUE_NAME, { connection: { url: env.REDIS_URL } });

  await queue.add(
    REPEAT_JOB_NAME,
    {},
    {
      repeat: { pattern: "0 4 * * *" },
      jobId: REPEAT_JOB_NAME,
      removeOnComplete: true,
      removeOnFail: 50
    }
  );

  worker = new Worker(QUEUE_NAME, async () => pruneOldMetrics(), {
    connection: { url: env.REDIS_URL }
  });

  worker.on("completed", (_job, result) => {
    logInfo("metrics.retention.completed", result as Record<string, unknown>);
  });

  worker.on("failed", (_job, error) => {
    logError("metrics.retention.failed", { error: error.message });
  });

  return worker;
}

export async function pruneOldMetrics(now = new Date()) {
  const cutoff = new Date(now.getTime() - env.METRICS_RETENTION_DAYS * 86_400_000);

  const result = await prisma.monitoringMetric.deleteMany({
    where: { recordedAt: { lt: cutoff } }
  });

  return { deleted: result.count, cutoff: cutoff.toISOString() };
}

export async function stopMetricsRetentionProcessor() {
  await worker?.close();
  await queue?.close();
  worker = null;
  queue = null;
}
