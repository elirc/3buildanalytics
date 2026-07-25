import { randomUUID } from "node:crypto";

import type { NextFunction, Request, Response } from "express";

import { logInfo } from "../shared/utils/logger.js";
import { metricsCollector } from "../shared/metrics/collector.js";

export function requestLoggerMiddleware(request: Request, response: Response, next: NextFunction) {
  const start = Date.now();
  request.requestId = request.headers["x-request-id"]?.toString() ?? randomUUID();
  response.setHeader("x-request-id", request.requestId);

  response.on("finish", () => {
    const durationMs = Date.now() - start;

    logInfo("request.completed", {
      requestId: request.requestId,
      method: request.method,
      path: request.originalUrl,
      statusCode: response.statusCode,
      durationMs
    });

    // route.path is the *pattern* ("/:id"); originalUrl would create a
    // distinct metric name per id and turn the metrics table into a slow
    // copy of the access log.
    const pattern = request.route?.path
      ? `${request.baseUrl}${request.route.path}`
      : request.baseUrl || "unmatched";

    metricsCollector.recordRequest({
      route: pattern,
      method: request.method,
      statusCode: response.statusCode,
      durationMs
    });
  });

  next();
}
