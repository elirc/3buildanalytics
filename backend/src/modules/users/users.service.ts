import { Prisma, type Role } from "@prisma/client";

import { prisma } from "../../db/prisma.js";
import { AppError } from "../../shared/errors/AppError.js";
import { ERROR_CODES } from "../../shared/errors/errorCodes.js";
import { getPagination } from "../../shared/utils/pagination.js";
import { hashPassword } from "../../shared/utils/password.js";
import { resolveSort, toPageCount } from "../../shared/utils/sorting.js";
import { auditService } from "../audit/audit.service.js";
import { USER_SORT_COLUMNS } from "./users.schemas.js";

/** Never select passwordHash. Omitting it here means it cannot leak by accident. */
const PUBLIC_FIELDS = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true
} as const;

export const usersService = {
  async list(input: {
    page?: number;
    pageSize?: number;
    search?: string;
    role?: Role;
    isActive?: boolean;
    sortBy?: string;
    sortDir?: string;
  }) {
    const pagination = getPagination(input);
    const sort = resolveSort({
      sortBy: input.sortBy,
      sortDir: input.sortDir,
      allowed: USER_SORT_COLUMNS,
      defaultColumn: "createdAt"
    });

    const where: Prisma.UserWhereInput = {
      role: input.role,
      isActive: input.isActive,
      OR: input.search
        ? [
            { email: { contains: input.search, mode: "insensitive" } },
            { firstName: { contains: input.search, mode: "insensitive" } },
            { lastName: { contains: input.search, mode: "insensitive" } }
          ]
        : undefined
    };

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: [{ [sort.column]: sort.direction }, { id: "asc" }],
        select: PUBLIC_FIELDS
      }),
      prisma.user.count({ where })
    ]);

    return {
      items,
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      pageCount: toPageCount(total, pagination.pageSize),
      sortBy: sort.column,
      sortDir: sort.direction
    };
  },

  /**
   * Creates a user.
   *
   * Shared by the admin endpoint and by self-registration, so the two cannot
   * drift in how they hash, normalise or audit. The caller decides what role is
   * permitted — see auth.service.register, which forces READ_ONLY.
   */
  async create(input: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: Role;
    createdById?: string;
  }) {
    const email = input.email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AppError(ERROR_CODES.CONFLICT, "User already exists", 409);
    }

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(input.password),
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role
      },
      select: PUBLIC_FIELDS
    });

    await prisma.trackedEvent.create({
      data: {
        eventType: "USER_SIGNED_UP",
        actorId: input.createdById ?? user.id,
        actorEmail: user.email,
        entityType: "User",
        entityId: user.id,
        metadata: { role: user.role, createdByAdmin: Boolean(input.createdById) }
      }
    });

    await auditService.record({
      actorId: input.createdById ?? user.id,
      action: "USER_CREATED",
      entityType: "User",
      entityId: user.id,
      metadata: { role: user.role, email: user.email }
    });

    return user;
  },

  async update(
    id: string,
    input: { firstName?: string; lastName?: string; role?: Role; isActive?: boolean },
    actor: { id: string }
  ) {
    const target = await prisma.user.findUnique({ where: { id } });

    if (!target) {
      throw new AppError(ERROR_CODES.NOT_FOUND, "User not found", 404);
    }

    const isSelf = target.id === actor.id;

    // Changing your own role mid-session is the classic way to lock yourself
    // out of the very screen you would need to undo it.
    if (isSelf && input.role !== undefined && input.role !== target.role) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "You cannot change your own role", 400);
    }

    if (isSelf && input.isActive === false) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "You cannot deactivate your own account", 400);
    }

    // Losing the last admin means nobody can ever restore one — there is no
    // break-glass path in this product.
    const losesAdmin =
      target.role === "SYSTEM_ADMIN" &&
      ((input.role !== undefined && input.role !== "SYSTEM_ADMIN") || input.isActive === false);

    if (losesAdmin) {
      const remainingAdmins = await prisma.user.count({
        where: { role: "SYSTEM_ADMIN", isActive: true, id: { not: target.id } }
      });

      if (remainingAdmins === 0) {
        throw new AppError(
          ERROR_CODES.BAD_REQUEST,
          "This is the last active system admin. Promote another admin first.",
          400
        );
      }
    }

    const isDeactivating = input.isActive === false && target.isActive;

    const updated = await prisma.$transaction(async (transaction) => {
      const next = await transaction.user.update({
        where: { id },
        data: input,
        select: PUBLIC_FIELDS
      });

      // Deactivation has to end sessions in the same transaction, or a
      // concurrent refresh can mint a new token against a user we just
      // disabled.
      if (isDeactivating) {
        await transaction.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() }
        });
      }

      return next;
    });

    // Typed as Prisma's JSON input so it can be stored directly. `unknown`
    // values do not satisfy InputJsonValue, and casting at the call site would
    // hide a real constraint: only JSON-serialisable values belong in metadata.
    const changes: Record<string, Prisma.InputJsonValue> = {};
    for (const key of ["firstName", "lastName", "role", "isActive"] as const) {
      if (input[key] !== undefined && input[key] !== target[key]) {
        changes[key] = { from: target[key], to: input[key] } as Prisma.InputJsonValue;
      }
    }

    if (Object.keys(changes).length > 0) {
      await auditService.record({
        actorId: actor.id,
        action: resolveAuditAction(changes),
        entityType: "User",
        entityId: id,
        // Before/after values, so the audit trail answers "what changed" and
        // not merely "something changed".
        metadata: { changes, email: target.email }
      });

      await prisma.trackedEvent.create({
        data: {
          eventType: "ADMIN_ACTION",
          actorId: actor.id,
          entityType: "User",
          entityId: id,
          metadata: { changes }
        }
      });
    }

    return updated;
  }
};

function resolveAuditAction(changes: Record<string, unknown>) {
  if ("isActive" in changes) {
    const change = changes.isActive as { to: boolean };
    return change.to ? "USER_REACTIVATED" : "USER_DEACTIVATED";
  }
  if ("role" in changes) {
    return "USER_ROLE_CHANGED";
  }
  return "USER_UPDATED";
}
