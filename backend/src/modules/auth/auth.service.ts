import { Role } from "@prisma/client";

import { prisma } from "../../db/prisma.js";
import { AppError } from "../../shared/errors/AppError.js";
import { ERROR_CODES } from "../../shared/errors/errorCodes.js";
import { sha256 } from "../../shared/utils/hash.js";
import { hashPassword, verifyPassword } from "../../shared/utils/password.js";
import { parseDurationToMs } from "../../shared/utils/duration.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../shared/utils/jwt.js";
import { getPermissionsForRole } from "../../shared/permissions.js";
import { auditService } from "../audit/audit.service.js";
import { usersService } from "../users/users.service.js";

interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: Role;
}

interface LoginInput {
  email: string;
  password: string;
}

export const authService = {
  /**
   * Public self-registration.
   *
   * The role is forced to READ_ONLY and the caller's requested role is ignored.
   * This endpoint is unauthenticated, and it previously honoured whatever role
   * the body asked for — so anyone who could reach the API could mint
   * themselves a SYSTEM_ADMIN. Privileged accounts are created through
   * POST /api/users, which requires users:manage.
   *
   * Creation itself is delegated to usersService so hashing, email
   * normalisation and audit logging cannot drift between the two paths.
   */
  async register(input: RegisterInput) {
    const user = await usersService.create({
      email: input.email,
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
      role: "READ_ONLY"
    });

    const fullUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return createSession(fullUser);
  },

  async login(input: LoginInput) {
    const user = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() }
    });

    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      await prisma.trackedEvent.create({
        data: {
          eventType: "USER_LOGIN_FAILED",
          actorEmail: input.email.toLowerCase(),
          entityType: "User",
          metadata: {
            source: "auth.login"
          }
        }
      });
      throw new AppError(ERROR_CODES.UNAUTHORIZED, "Invalid email or password", 401);
    }

    if (!user.isActive) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "User account is inactive", 403);
    }

    await prisma.trackedEvent.create({
      data: {
        eventType: "USER_LOGGED_IN",
        actorId: user.id,
        actorEmail: user.email,
        entityType: "User",
        entityId: user.id
      }
    });

    return createSession(user);
  },

  async getCurrentUser(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new AppError(ERROR_CODES.NOT_FOUND, "User not found", 404);
    }

    return sanitizeUser(user);
  },

  async refresh(refreshToken: string) {
    // Any verification failure — malformed, wrong signature, expired — is a
    // client error, so it becomes a 401. Previously jsonwebtoken's
    // JsonWebTokenError escaped as-is; it is not an AppError, so the error
    // middleware fell through to its catch-all and returned 500. Garbage from a
    // client is not a server fault.
    //
    // All three cases give the same answer on purpose, so the endpoint does not
    // reveal which kind of invalid a token was.
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, "Refresh token is invalid or expired", 401);
    }

    const tokenHash = sha256(refreshToken);

    // Look the token up regardless of its revoked state: finding a *revoked*
    // token is the signal we care about most.
    const storedToken = await prisma.refreshToken.findFirst({
      where: { userId: payload.sub, tokenHash },
      include: { user: true }
    });

    if (!storedToken) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, "Refresh token is invalid or expired", 401);
    }

    if (storedToken.revokedAt !== null) {
      // Reuse detection. A correctly behaving client never presents a token it
      // has already exchanged, so this means the token was captured and is
      // being replayed — either by an attacker or by the legitimate user after
      // an attacker got there first. We cannot tell which, so we end every
      // session for the account and make them all sign in again.
      await this.revokeAllForUser(storedToken.userId);

      await auditService.record({
        actorId: storedToken.userId,
        action: "REFRESH_TOKEN_REUSE_DETECTED",
        entityType: "RefreshToken",
        entityId: storedToken.id,
        metadata: { revokedAt: storedToken.revokedAt.toISOString() }
      });

      throw new AppError(ERROR_CODES.UNAUTHORIZED, "Refresh token is invalid or expired", 401);
    }

    if (storedToken.expiresAt <= new Date()) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, "Refresh token is invalid or expired", 401);
    }

    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() }
    });

    return createSession(storedToken.user);
  },

  async logout(refreshToken: string) {
    const tokenHash = sha256(refreshToken);

    await prisma.refreshToken.updateMany({
      where: {
        tokenHash,
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    });
  },

  /** Ends every session for a user. Used by logout-all and by reuse detection. */
  async revokeAllForUser(userId: string) {
    const result = await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() }
    });

    return result.count;
  }
};

async function createSession(user: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role
  };
  const refreshToken = signRefreshToken(payload);
  const refreshTokenExpiresAt = new Date(
    Date.now() + parseDurationToMs(process.env.JWT_REFRESH_EXPIRES_IN ?? "7d")
  );

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(refreshToken),
      expiresAt: refreshTokenExpiresAt
    }
  });

  return {
    user: sanitizeUser(user),
    accessToken: signAccessToken(payload),
    refreshToken
  };
}

function sanitizeUser(user: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    // Shipped with the session so the UI can render the correct navigation on
    // first paint, without a second round trip and without duplicating the
    // matrix as the client's own source of truth.
    permissions: getPermissionsForRole(user.role)
  };
}
