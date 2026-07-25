import { randomUUID } from "node:crypto";

import jwt, { type Secret, type SignOptions } from "jsonwebtoken";

import { env } from "../../config/env.js";

export interface JwtPayload {
  sub: string;
  role: string;
  email: string;
  /** Refresh tokens only — see signRefreshToken. */
  jti?: string;
}

export function signAccessToken(payload: JwtPayload) {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET as Secret, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as SignOptions["expiresIn"]
  });
}

/**
 * Refresh tokens get a random `jti`, and the function generates it rather than
 * trusting callers to remember.
 *
 * Without it the payload is just {sub, email, role} and the only varying claim
 * is `iat`, which has one-second resolution. Two tokens minted for one user
 * inside the same second were therefore byte-identical — and so were their
 * SHA-256 hashes.
 *
 * That made rotation useless in exactly the window where it matters: refresh()
 * revoked the row matching the presented hash and immediately inserted a new
 * row carrying the same hash, so replaying the "revoked" token found the fresh
 * row and succeeded. A unique jti makes every token distinct.
 */
export function signRefreshToken(payload: JwtPayload) {
  return jwt.sign(
    { ...payload, jti: payload.jti ?? randomUUID() },
    env.JWT_REFRESH_SECRET as Secret,
    {
      expiresIn: env.JWT_REFRESH_EXPIRES_IN as SignOptions["expiresIn"]
    }
  );
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
}

export function verifyRefreshToken(token: string) {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtPayload;
}
