import type { Role } from "@prisma/client";

import { signAccessToken } from "../../src/shared/utils/jwt.js";

/**
 * Mint a real access token for a user.
 *
 * Deliberately does NOT stub `request.user`. Tests go through the genuine
 * middleware chain — authMiddleware verifies the signature, requirePermission
 * consults the real matrix — so a change to either is caught by the tests
 * rather than silently bypassed by a mock.
 */
export function authHeaderFor(user: { id: string; email: string; role: Role }) {
  const token = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role
  });

  return { Authorization: `Bearer ${token}` };
}

/** A structurally valid token signed with the wrong secret. */
export function invalidAuthHeader() {
  return { Authorization: "Bearer not-a-real-token" };
}
