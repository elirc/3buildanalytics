import { Queue, Worker } from "bullmq";

import { env } from "../config/env.js";
import { exportCleanupService } from "../modules/exports/exportCleanup.service.js";
import { logError, logInfo, logWarn } from "../shared/utils/logger.js";

const QUEUE_NAME = "export-cleanup";
const REPEAT_JOB_NAME = "SWEEP_EXPIRED_EXPORTS";

let worker: Worker | null = null;
let queue: Queue | null = null;

/**
 * Hourly sweep for expired exports.
 *
 * Registered from worker.ts only, not from server.ts. Every API instance
 * running its own copy of a repeatable job means N sweeps an hour racing each
 * other over the same rows for no benefit.
 */
export async function registerExportCleanupProcessor() {
  if (worker) {
    return worker;
  }

  queue = new Queue(QUEUE_NAME, { connection: { url: env.REDIS_URL } });

  // A fixed jobId means re-registering on every deploy updates the schedule
  // instead of stacking another repeatable job on top of it.
  await queue.add(
    REPEAT_JOB_NAME,
    {},
    {
      repeat: { pattern: "0 * * * *" },
      jobId: REPEAT_JOB_NAME,
      removeOnComplete: true,
      removeOnFail: 50
    }
  );

  worker = new Worker(
    QUEUE_NAME,
    async () => {
      const result = await exportCleanupService.run();
      return result;
    },
    { connection: { url: env.REDIS_URL } }
  );

  worker.on("completed", (_job, result) => {
    logInfo("export.cleanup.job.completed", result as Record<string, unknown>);
  });

  worker.on("failed", (_job, error) => {
    logError("export.cleanup.job.failed", { error: error.message });
  });

  logInfo("export.cleanup.registered", { retentionDays: exportCleanupService.retentionDays() });

  return worker;
}

/** Best-effort teardown so a shutdown does not leave the connection open. */
export async function stopExportCleanupProcessor() {
  try {
    await worker?.close();
    await queue?.close();
  } catch (error) {
    logWarn("export.cleanup.shutdown_failed", {
      error: error instanceof Error ? error.message : "unknown"
    });
  } finally {
    worker = null;
    queue = null;
  }
}
