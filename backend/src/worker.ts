import { registerExportProcessor } from "./jobs/export.processor.js";
import { registerExportCleanupProcessor } from "./jobs/exportCleanup.processor.js";
import { registerMetricSnapshotProcessor } from "./jobs/metricSnapshot.processor.js";
import { registerAlertEvaluationProcessor } from "./jobs/alertEvaluation.processor.js";
import { getRedisClient } from "./cache/redis.js";
import { logInfo, logWarn } from "./shared/utils/logger.js";

async function bootstrapWorker() {
  try {
    await getRedisClient().connect();
    await registerExportProcessor();
    // Registered here and not in server.ts: a repeatable job running in every
    // API instance means N sweeps an hour racing over the same rows.
    await registerExportCleanupProcessor();
    await registerMetricSnapshotProcessor();
    await registerAlertEvaluationProcessor();
    logInfo("worker.started", { queues: ["exports", "export-cleanup", "metric-snapshots", "alert-evaluation"] });
  } catch (error) {
    logWarn("worker.failed_to_start", {
      error: error instanceof Error ? error.message : "unknown"
    });
    process.exit(1);
  }
}

bootstrapWorker();
