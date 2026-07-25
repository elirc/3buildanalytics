import { Queue, Worker } from "bullmq";

import { env } from "../config/env.js";
import { metricSnapshotService } from "../modules/dashboard/metricSnapshot.service.js";
import { logError, logInfo } from "../shared/utils/logger.js";

const QUEUE_NAME = "metric-snapshots";
const REPEAT_JOB_NAME = "ROLLUP_YESTERDAY";

let worker: Worker | null = null;
let queue: Queue | null = null;

/**
 * Nightly rollup of the previous UTC day.
 *
 * Runs at 03:00 rather than midnight so it is comfortably clear of the day
 * boundary — a job that starts at 23:59:58 and rolls "today" produces a partial
 * day that looks complete.
 *
 * Registered from worker.ts only. A repeatable job in every API instance means
 * N rollups a night writing the same rows.
 */
export async function registerMetricSnapshotProcessor() {
  if (worker) {
    return worker;
  }

  queue = new Queue(QUEUE_NAME, { connection: { url: env.REDIS_URL } });

  await queue.add(
    REPEAT_JOB_NAME,
    {},
    {
      repeat: { pattern: "0 3 * * *" },
      jobId: REPEAT_JOB_NAME,
      removeOnComplete: true,
      removeOnFail: 50
    }
  );

  worker = new Worker(
    QUEUE_NAME,
    async () => {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      return metricSnapshotService.rollupDay(yesterday);
    },
    { connection: { url: env.REDIS_URL } }
  );

  worker.on("completed", (_job, result) => {
    logInfo("metric_snapshot.job.completed", result as Record<string, unknown>);
  });

  worker.on("failed", (_job, error) => {
    logError("metric_snapshot.job.failed", { error: error.message });
  });

  return worker;
}

export async function stopMetricSnapshotProcessor() {
  await worker?.close();
  await queue?.close();
  worker = null;
  queue = null;
}
