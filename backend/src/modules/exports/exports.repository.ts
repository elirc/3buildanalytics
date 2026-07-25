import { prisma } from "../../db/prisma.js";

export const exportsRepository = {
  create(data: Parameters<typeof prisma.exportJob.create>[0]["data"]) {
    return prisma.exportJob.create({ data });
  },

  listByUser(userId: string) {
    return prisma.exportJob.findMany({
      where: { requestedById: userId },
      orderBy: { createdAt: "desc" }
    });
  },

  /** Admin view. Includes the requester's email so a support view is readable. */
  listAll() {
    return prisma.exportJob.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        requestedBy: { select: { id: true, email: true, firstName: true, lastName: true } }
      }
    });
  },

  findById(id: string) {
    return prisma.exportJob.findUnique({
      where: { id }
    });
  },

  update(id: string, data: Parameters<typeof prisma.exportJob.update>[0]["data"]) {
    return prisma.exportJob.update({
      where: { id },
      data
    });
  }
};
