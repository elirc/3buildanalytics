import type { Prisma } from "@prisma/client";

import { prisma } from "../../db/prisma.js";

const OWNER_SELECT = {
  select: { id: true, email: true, firstName: true, lastName: true }
} as const;

export const savedViewsRepository = {
  /** The caller's own views plus anything shared, oldest name first. */
  async listVisibleTo(userId: string, page?: string) {
    return prisma.savedView.findMany({
      where: {
        AND: [
          page ? { page } : {},
          {
            OR: [{ ownerId: userId }, { isShared: true }]
          }
        ]
      },
      include: { owner: OWNER_SELECT },
      orderBy: [{ name: "asc" }]
    });
  },

  async findById(id: string) {
    return prisma.savedView.findUnique({
      where: { id },
      include: { owner: OWNER_SELECT }
    });
  },

  async countForOwner(ownerId: string) {
    return prisma.savedView.count({ where: { ownerId } });
  },

  async create(data: {
    name: string;
    ownerId: string;
    page: string;
    filtersJson: Prisma.InputJsonValue;
    isShared: boolean;
  }) {
    return prisma.savedView.create({ data, include: { owner: OWNER_SELECT } });
  },

  async update(
    id: string,
    data: { name?: string; filtersJson?: Prisma.InputJsonValue; isShared?: boolean }
  ) {
    return prisma.savedView.update({
      where: { id },
      data,
      include: { owner: OWNER_SELECT }
    });
  },

  async remove(id: string) {
    await prisma.savedView.delete({ where: { id } });
  }
};
