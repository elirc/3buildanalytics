import { Router } from "express";

import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { requireAuthenticated } from "../../middleware/requireAuthenticated.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { authRateLimit } from "../../middleware/rateLimit.middleware.js";
import { authController } from "./auth.controller.js";
import { loginSchema, logoutSchema, refreshSchema, registerSchema } from "./auth.schemas.js";

export const authRouter = Router();

authRouter.post("/register", authRateLimit, validate(registerSchema), asyncHandler(authController.register));
authRouter.post("/login", authRateLimit, validate(loginSchema), asyncHandler(authController.login));
authRouter.post("/refresh", validate(refreshSchema), asyncHandler(authController.refresh));
authRouter.post("/logout", validate(logoutSchema), asyncHandler(authController.logout));
// Signs the caller out everywhere. Requires an access token rather than a
// refresh token: the point is to end sessions you may no longer hold tokens for.
authRouter.post("/logout-all", requireAuthenticated, asyncHandler(authController.logoutAll));
authRouter.get("/me", requireAuthenticated, asyncHandler(authController.me));
authRouter.get("/permissions", requireAuthenticated, asyncHandler(authController.permissions));
