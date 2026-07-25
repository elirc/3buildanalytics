import { registerExportProcessor } from "./jobs/export.processor.js";
import { registerExportCleanupProcessor } from "./jobs/exportCleanup.processor.js";
import { getRedisClient } from "./cache/redis.js";
import { logInfo, logWarn } from "./shared/utils/logger.js";

async function bootstrapWorker() {
  try {
    await getRedisClient().connect();
    await registerExportProcessor();
    // Registered here and not in server.ts: a repeatable job running in every
    // API instance means N sweeps an hour racing over the same rows.
    await registerExportCleanupProcessor();
    logInfo("worker.started", { queues: ["exports", "export-cleanup"] });
  } catch (error) {
    logWarn("worker.failed_to_start", {
      error: error instanceof Error ? error.message : "unknown"
    });
    process.exit(1);
  }
}

bootstrapWorker();
