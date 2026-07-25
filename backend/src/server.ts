import { createApp } from "./app.js";
import { registerExportProcessor } from "./jobs/export.processor.js";
import { env } from "./config/env.js";
import { prisma } from "./db/prisma.js";
import { getRedisClient } from "./cache/redis.js";
import { logInfo, logWarn } from "./shared/utils/logger.js";
import { metricsCollector } from "./shared/metrics/collector.js";

async function bootstrap() {
  await prisma.$connect();

  try {
    await getRedisClient().connect();
    await registerExportProcessor();
  } catch (error) {
    logWarn("redis.connection.skipped", {
      error: error instanceof Error ? error.message : "unknown"
    });
  }

  metricsCollector.start();

  const app = createApp();
  app.listen(env.BACKEND_PORT, () => {
    logInfo("server.started", {
      port: env.BACKEND_PORT,
      url: `http://localhost:${env.BACKEND_PORT}`
    });
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
