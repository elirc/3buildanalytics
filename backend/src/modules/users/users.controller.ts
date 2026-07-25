import type { Role } from "@prisma/client";
import type { Request, Response } from "express";

import { usersService } from "./users.service.js";

export const usersController = {
  async list(request: Request, response: Response) {
    const result = await usersService.list({
      // Guarded rather than Number()'d directly: Number(undefined) is NaN, and
      // NaN silently defeats the clamping in getPagination.
      page: request.query.page ? Number(request.query.page) : undefined,
      pageSize: request.query.pageSize ? Number(request.query.pageSize) : undefined,
      search: request.query.search ? String(request.query.search) : undefined,
      role: request.query.role ? (String(request.query.role) as Role) : undefined,
      isActive: request.query.isActive === undefined ? undefined : request.query.isActive === "true",
      sortBy: request.query.sortBy ? String(request.query.sortBy) : undefined,
      sortDir: request.query.sortDir ? String(request.query.sortDir) : undefined
    });

    response.status(200).json(result);
  },

  async create(request: Request, response: Response) {
    const result = await usersService.create({
      email: request.body.email,
      password: request.body.password,
      firstName: request.body.firstName,
      lastName: request.body.lastName,
      role: request.body.role,
      createdById: request.user!.id
    });

    response.status(201).json(result);
  },

  async patch(request: Request, response: Response) {
    const result = await usersService.update(String(request.params.id), request.body, {
      id: request.user!.id
    });

    response.status(200).json(result);
  }
};
