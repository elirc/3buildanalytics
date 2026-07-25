import { Router } from "express";

import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { requirePermission } from "../../middleware/requirePermission.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { savedViewsController } from "./savedViews.controller.js";
import {
  createSavedViewSchema,
  listSavedViewsSchema,
  savedViewIdSchema,
  updateSavedViewSchema
} from "./savedViews.schemas.js";

export const savedViewsRouter = Router();

savedViewsRouter.use(requirePermission("views:manage"));

savedViewsRouter.get("/", validate(listSavedViewsSchema), asyncHandler(savedViewsController.list));
savedViewsRouter.post("/", validate(createSavedViewSchema), asyncHandler(savedViewsController.create));
savedViewsRouter.patch("/:id", validate(updateSavedViewSchema), asyncHandler(savedViewsController.patch));
savedViewsRouter.delete("/:id", validate(savedViewIdSchema), asyncHandler(savedViewsController.remove));
