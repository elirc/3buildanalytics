import { Router } from "express";

import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { requirePermission } from "../../middleware/requirePermission.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { createDashboardConfigSchema, defaultConfigSchema, updateDashboardConfigSchema } from "./dashboardConfigs.schemas.js";
import { dashboardConfigsController } from "./dashboardConfigs.controller.js";

export const dashboardConfigsRouter = Router();

// Readable with dashboard:view, not dashboard:configure: a user must be able to
// read the layout they are shown without being able to edit it. Declared before
// "/:id" so "default" is not swallowed by the id route.
dashboardConfigsRouter.get("/default", requirePermission("dashboard:view"), validate(defaultConfigSchema), asyncHandler(dashboardConfigsController.getDefault));
dashboardConfigsRouter.get("/", requirePermission("dashboard:configure"), asyncHandler(dashboardConfigsController.list));
dashboardConfigsRouter.post("/", requirePermission("dashboard:configure"), validate(createDashboardConfigSchema), asyncHandler(dashboardConfigsController.create));
dashboardConfigsRouter.get("/:id", requirePermission("dashboard:configure"), asyncHandler(dashboardConfigsController.getById));
dashboardConfigsRouter.patch("/:id", requirePermission("dashboard:configure"), validate(updateDashboardConfigSchema), asyncHandler(dashboardConfigsController.patch));
dashboardConfigsRouter.delete("/:id", requirePermission("dashboard:configure"), asyncHandler(dashboardConfigsController.remove));
