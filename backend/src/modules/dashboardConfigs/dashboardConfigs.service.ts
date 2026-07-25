import { Prisma, type Role } from "@prisma/client";

import { prisma } from "../../db/prisma.js";
import { AppError } from "../../shared/errors/AppError.js";
import { ERROR_CODES } from "../../shared/errors/errorCodes.js";
import { hasPermission } from "../../shared/permissions.js";
import { WIDGET_IDS, widgetPermission, type WidgetId } from "./widgets.js";

export const dashboardConfigsService = {
  async list() {
    return prisma.dashboardConfig.findMany({
      orderBy: [{ role: "asc" }, { createdAt: "desc" }]
    });
  },

  /**
   * The default layout for a role, with widgets the caller may not see removed.
   *
   * Filtering happens here rather than in the client so a saved config cannot
   * leak a monitoring widget to a role without monitoring:view. The endpoint is
   * readable with dashboard:view — users need to *read* their layout without
   * being able to *edit* it, which dashboard:configure would have required.
   *
   * Returns null rather than 404 when no config exists: having no saved layout
   * is a normal state, and the client falls back to a built-in default.
   */
  async getDefaultForRole(role: Role, viewerRole: Role) {
    const config = await prisma.dashboardConfig.findFirst({
      where: { role, isDefault: true },
      orderBy: { updatedAt: "desc" }
    });

    if (!config) {
      return null;
    }

    const layout = config.layoutJson as { widgets?: Array<{ id: string; size?: string }> } | null;
    const widgets = (layout?.widgets ?? []).filter((widget) =>
      WIDGET_IDS.includes(widget.id as WidgetId)
        ? hasPermission(viewerRole, widgetPermission(widget.id as WidgetId))
        : false
    );

    return { ...config, layoutJson: { widgets } };
  },

  async create(input: {
    name: string;
    description?: string;
    role: Express.User["role"];
    layoutJson: Record<string, unknown>;
    isDefault?: boolean;
  }) {
    return prisma.dashboardConfig.create({
      data: {
        ...input,
        layoutJson: input.layoutJson as Prisma.InputJsonValue
      }
    });
  },

  async getById(id: string) {
    const item = await prisma.dashboardConfig.findUnique({ where: { id } });

    if (!item) {
      throw new AppError(ERROR_CODES.NOT_FOUND, "Dashboard config not found", 404);
    }

    return item;
  },

  async update(
    id: string,
    input: {
      name?: string;
      description?: string;
      role?: Express.User["role"];
      layoutJson?: Record<string, unknown>;
      isDefault?: boolean;
    }
  ) {
    await this.getById(id);

    return prisma.$transaction(async (transaction) => {
      if (input.isDefault && input.role) {
        await transaction.dashboardConfig.updateMany({
          where: { role: input.role, id: { not: id } },
          data: { isDefault: false }
        });
      }

      return transaction.dashboardConfig.update({
        where: { id },
        data: {
          ...input,
          layoutJson: input.layoutJson as Prisma.InputJsonValue | undefined
        }
      });
    });
  },

  async remove(id: string) {
    await this.getById(id);
    await prisma.dashboardConfig.delete({ where: { id } });
  }
};
