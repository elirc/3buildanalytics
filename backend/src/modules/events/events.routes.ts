import { Router } from "express";

import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { requirePermission } from "../../middleware/requirePermission.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { eventIdSchema, listEventsSchema, trackEventSchema } from "./events.schemas.js";
import { eventsController } from "./events.controller.js";

export const eventsRouter = Router();

// A write gated by a *write* permission. It was events:view, so the ability to
// record events was implied by the ability to read them — exactly the
// conflation that makes a permission matrix stop meaning anything.
//
// READ_ONLY and EXECUTIVE_VIEWER stay excluded. Both are view-only by
// definition, and telemetry for those users is emitted server-side by the
// endpoints they call rather than by the client.
eventsRouter.post("/track", requirePermission("events:write"), validate(trackEventSchema), asyncHandler(eventsController.track));
eventsRouter.get("/", requirePermission("events:view"), validate(listEventsSchema), asyncHandler(eventsController.list));
eventsRouter.get("/summary/by-type", requirePermission("events:view"), validate(listEventsSchema), asyncHandler(eventsController.summaryByType));
eventsRouter.get("/summary/over-time", requirePermission("events:view"), validate(listEventsSchema), asyncHandler(eventsController.summaryOverTime));
eventsRouter.get("/:id", requirePermission("events:view"), validate(eventIdSchema), asyncHandler(eventsController.getById));
