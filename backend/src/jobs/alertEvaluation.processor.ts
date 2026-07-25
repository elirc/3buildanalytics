import { Queue, Worker } from "bullmq";

import { env } from "../config/env.js";
import { alertsService } from "../modules/alerts/alerts.service.js";
import { logError, logInfo } from "../shared/utils/logger.js";

const QUEUE_NAME = "alert-evaluation";
const REPEAT_JOB_NAME = "EVALUATE_ALERT_RULES";

let worker: Worker | null = null;
let queue: Queue | null = null;

/**
 * Evaluates alert rules once a minute.
 *
 * A minute is the shortest interval worth having here: rules average over a
 * window of minutes, so evaluating more often re-reads the same data without
 * learning anything new.
 *
 * Registered from worker.ts only. Two instances evaluating concurrently would
 * both see "no open event" for a breaching rule and both create one, which is
 * exactly the duplicate the dedup logic exists to prevent.
 */
export async function registerAlertEvaluationProcessor() {
  if (worker) {
    return worker;
  }

  queue = new Queue(QUEUE_NAME, { connection: { url: env.REDIS_URL } });

  await queue.add(
    REPEAT_JOB_NAME,
    {},
    {
      repeat: { pattern: "* * * * *" },
      jobId: REPEAT_JOB_NAME,
      removeOnComplete: true,
      removeOnFail: 50
    }
  );

  worker = new Worker(QUEUE_NAME, async () => alertsService.evaluateAll(), {
    connection: { url: env.REDIS_URL },
    // One evaluation at a time within this process, for the same reason the job
    // is registered in one place.
    concurrency: 1
  });

  worker.on("failed", (_job, error) => {
    logError("alerts.evaluation.failed", { error: error.message });
  });

  logInfo("alerts.evaluation.registered", {});

  return worker;
}

export async function stopAlertEvaluationProcessor() {
  await worker?.close();
  await queue?.close();
  worker = null;
  queue = null;
}
