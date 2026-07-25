import { Router } from "express";

import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { requirePermission } from "../../middleware/requirePermission.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { alertsController } from "./alerts.controller.js";
import {
  alertRuleIdSchema,
  createAlertRuleSchema,
  listAlertEventsSchema,
  updateAlertRuleSchema
} from "./alerts.schemas.js";

export const alertsRouter = Router();

// Reading alerts needs monitoring:view; changing the rules needs alerts:manage.
// Anyone who can see the monitoring page should see what is currently wrong;
// deciding what counts as wrong is a narrower privilege.
alertsRouter.get("/rules", requirePermission("monitoring:view"), asyncHandler(alertsController.listRules));
alertsRouter.post("/rules", requirePermission("alerts:manage"), validate(createAlertRuleSchema), asyncHandler(alertsController.createRule));
alertsRouter.patch("/rules/:id", requirePermission("alerts:manage"), validate(updateAlertRuleSchema), asyncHandler(alertsController.patchRule));
alertsRouter.delete("/rules/:id", requirePermission("alerts:manage"), validate(alertRuleIdSchema), asyncHandler(alertsController.deleteRule));

alertsRouter.get("/events", requirePermission("monitoring:view"), validate(listAlertEventsSchema), asyncHandler(alertsController.listEvents));
alertsRouter.post("/events/:id/acknowledge", requirePermission("monitoring:view"), validate(alertRuleIdSchema), asyncHandler(alertsController.acknowledge));
