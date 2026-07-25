import type { NextFunction, Request, Response } from "express";

import { getRedisClient } from "../cache/redis.js";
import { env } from "../config/env.js";
import { AppError } from "../shared/errors/AppError.js";
import { ERROR_CODES } from "../shared/errors/errorCodes.js";
import { logWarn } from "../shared/utils/logger.js";

export interface RateLimitOptions {
  /** Requests permitted per window. */
  points: number;
  windowMs: number;
  /** Prefix so tiers cannot share a bucket. */
  bucket: string;
  /**
   * Force IP-based keying even for authenticated callers.
   *
   * Login and registration must key on IP: the whole point is to slow down
   * someone guessing credentials, and they are unauthenticated by definition,
   * so there is no user to key on.
   */
  keyByIpOnly?: boolean;
}

/**
 * Redis-backed fixed-window rate limiter.
 *
 * Replaces a module-level Map keyed by IP. That version had four problems:
 * it was per-process (two instances meant double the effective limit, and a
 * deploy reset it), it never evicted entries so every distinct IP was
 * remembered forever, it keyed only on IP so an office behind one NAT shared a
 * budget, and it reported status 429 with the code FORBIDDEN — so a client
 * matching on error.code could not tell rate limiting from a permission
 * failure.
 *
 * Fixed window rather than sliding: one INCR plus one EXPIRE, versus a sorted
 * set per key. A caller can burst across a window boundary, which is an
 * acceptable trade for a limiter whose job is to stop abuse rather than to
 * shape traffic precisely.
 */
export function rateLimit(options: RateLimitOptions) {
  return async (request: Request, response: Response, next: NextFunction) => {
    const identifier =
      !options.keyByIpOnly && request.user?.id
        ? `user:${request.user.id}`
        : `ip:${request.ip ?? "unknown"}`;

    // The window number makes the key self-expiring by construction: a new
    // window is a new key, so nothing has to be reset.
    const window = Math.floor(Date.now() / options.windowMs);
    const key = `ratelimit:${options.bucket}:${identifier}:${window}`;

    let used: number;

    try {
      const client = getRedisClient();
      used = await client.incr(key);

      if (used === 1) {
        // Only the first request in a window sets the TTL, so the window does
        // not slide forward on every request.
        await client.pexpire(key, options.windowMs);
      }
    } catch (error) {
      /**
       * Fail open.
       *
       * Availability over enforcement: a rate limiter that rejects everything
       * when its own dependency is down converts a Redis outage into a full
       * outage. The limiter exists to blunt abuse, not to be a gate the
       * application cannot serve without.
       *
       * The trade is real — during a Redis outage there is no limiting — and it
       * is logged so the gap is visible rather than silent.
       */
      logWarn("ratelimit.unavailable.failing_open", {
        bucket: options.bucket,
        error: error instanceof Error ? error.message : "unknown"
      });
      return next();
    }

    const remaining = Math.max(0, options.points - used);
    const resetAt = (window + 1) * options.windowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));

    response.setHeader("x-ratelimit-limit", String(options.points));
    response.setHeader("x-ratelimit-remaining", String(remaining));
    response.setHeader("x-ratelimit-reset", String(Math.floor(resetAt / 1000)));

    if (used > options.points) {
      response.setHeader("retry-after", String(retryAfterSeconds));

      return next(
        new AppError(
          ERROR_CODES.RATE_LIMITED,
          `Too many requests. Try again in ${retryAfterSeconds}s.`,
          429
        )
      );
    }

    return next();
  };
}

/** The default tier, applied to everything without a stricter one. */
export const rateLimitMiddleware = rateLimit({
  points: env.RATE_LIMIT_MAX_REQUESTS,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  bucket: "global"
});

/**
 * Credential endpoints: 5 attempts per 15 minutes, per IP.
 *
 * Deliberately far stricter than the global tier. Brute-forcing a password is
 * the one thing here worth making genuinely slow.
 */
export const authRateLimit = rateLimit({
  points: 5,
  windowMs: 15 * 60_000,
  bucket: "auth",
  keyByIpOnly: true
});

/** Exports are expensive to produce, so they get their own budget. */
export const exportRateLimit = rateLimit({
  points: 10,
  windowMs: 60 * 60_000,
  bucket: "exports"
});
