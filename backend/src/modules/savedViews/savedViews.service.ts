import { Prisma } from "@prisma/client";

import { AppError } from "../../shared/errors/AppError.js";
import { ERROR_CODES } from "../../shared/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";
import { savedViewsRepository } from "./savedViews.repository.js";

/**
 * Per-user cap. Not a business rule so much as a guard rail: without a limit a
 * script can fill the table, and the dropdown stops being usable long before
 * that.
 */
const MAX_VIEWS_PER_USER = 50;

export const savedViewsService = {
  async list(userId: string, page?: string) {
    return savedViewsRepository.listVisibleTo(userId, page);
  },

  async create(input: {
    ownerId: string;
    name: string;
    page: string;
    filtersJson: Record<string, unknown>;
    isShared?: boolean;
  }) {
    const existing = await savedViewsRepository.countForOwner(input.ownerId);
    if (existing >= MAX_VIEWS_PER_USER) {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        `You can save at most ${MAX_VIEWS_PER_USER} views. Delete one to make room.`,
        400
      );
    }

    try {
      const view = await savedViewsRepository.create({
        // The owner is always the caller. Taking it from the body would let
        // anyone create views in someone else's name.
        ownerId: input.ownerId,
        name: input.name,
        page: input.page,
        filtersJson: input.filtersJson as Prisma.InputJsonValue,
        isShared: input.isShared ?? false
      });

      await auditService.record({
        actorId: input.ownerId,
        action: "SAVED_VIEW_CREATED",
        entityType: "SavedView",
        entityId: view.id,
        metadata: { name: view.name, page: view.page, isShared: view.isShared }
      });

      return view;
    } catch (error) {
      // P2002 = unique constraint. Translating it here keeps the 409 close to
      // the constraint that produced it, rather than leaking a Prisma error.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          `You already have a view named "${input.name}" on this page.`,
          409
        );
      }
      throw error;
    }
  },

  async update(
    id: string,
    actorId: string,
    input: { name?: string; filtersJson?: Record<string, unknown>; isShared?: boolean }
  ) {
    const view = await this.getOwnedOrThrow(id, actorId);

    const updated = await savedViewsRepository.update(view.id, {
      name: input.name,
      filtersJson: input.filtersJson as Prisma.InputJsonValue | undefined,
      isShared: input.isShared
    });

    await auditService.record({
      actorId,
      action: "SAVED_VIEW_UPDATED",
      entityType: "SavedView",
      entityId: view.id,
      metadata: { name: updated.name, isShared: updated.isShared }
    });

    return updated;
  },

  async remove(id: string, actorId: string, actorRole: Express.User["role"]) {
    const view = await savedViewsRepository.findById(id);

    // Admins can clean up anyone's view; everyone else only their own.
    if (!view || (view.ownerId !== actorId && actorRole !== "SYSTEM_ADMIN")) {
      throw new AppError(ERROR_CODES.NOT_FOUND, "Saved view not found", 404);
    }

    await savedViewsRepository.remove(view.id);

    await auditService.record({
      actorId,
      action: "SAVED_VIEW_DELETED",
      entityType: "SavedView",
      entityId: view.id,
      metadata: { name: view.name, ownerId: view.ownerId }
    });
  },

  /**
   * 404, not 403, when the view belongs to someone else.
   *
   * A 403 would confirm the id exists, which is a small but free information
   * leak. From a non-owner's point of view the resource may as well not exist.
   */
  async getOwnedOrThrow(id: string, actorId: string) {
    const view = await savedViewsRepository.findById(id);

    if (!view || view.ownerId !== actorId) {
      throw new AppError(ERROR_CODES.NOT_FOUND, "Saved view not found", 404);
    }

    return view;
  }
};
