import { Router } from "express";

import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { requirePermission } from "../../middleware/requirePermission.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { usersController } from "./users.controller.js";
import { createUserSchema, listUsersSchema, updateUserSchema } from "./users.schemas.js";

export const usersRouter = Router();

usersRouter.use(requirePermission("users:manage"));

usersRouter.get("/", validate(listUsersSchema), asyncHandler(usersController.list));
usersRouter.post("/", validate(createUserSchema), asyncHandler(usersController.create));
usersRouter.patch("/:id", validate(updateUserSchema), asyncHandler(usersController.patch));
