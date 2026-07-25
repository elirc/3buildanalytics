import { Router } from "express";

import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { requirePermission } from "../../middleware/requirePermission.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { exportRateLimit } from "../../middleware/rateLimit.middleware.js";
import { exportsController } from "./exports.controller.js";
import { createExportSchema, estimateExportSchema, exportIdSchema } from "./exports.schemas.js";

export const exportsRouter = Router();

exportsRouter.post("/", requirePermission("exports:create"), exportRateLimit, validate(createExportSchema), asyncHandler(exportsController.create));
// Same body as create, but creates nothing — lets the UI warn about a large
// export before the user commits to it.
exportsRouter.post("/estimate", requirePermission("exports:create"), validate(estimateExportSchema), asyncHandler(exportsController.estimate));
exportsRouter.get("/", requirePermission("exports:view"), asyncHandler(exportsController.list));
exportsRouter.get("/:id", requirePermission("exports:view"), validate(exportIdSchema), asyncHandler(exportsController.getById));
exportsRouter.get("/:id/download", requirePermission("exports:view"), validate(exportIdSchema), asyncHandler(exportsController.download));
exportsRouter.post("/:id/retry", requirePermission("exports:create"), validate(exportIdSchema), asyncHandler(exportsController.retry));
