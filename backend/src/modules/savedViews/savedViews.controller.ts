import type { Request, Response } from "express";

import { savedViewsService } from "./savedViews.service.js";

export const savedViewsController = {
  async list(request: Request, response: Response) {
    const result = await savedViewsService.list(
      request.user!.id,
      request.query.page ? String(request.query.page) : undefined
    );
    response.status(200).json(result);
  },

  async create(request: Request, response: Response) {
    const result = await savedViewsService.create({
      ownerId: request.user!.id,
      name: request.body.name,
      page: request.body.page,
      filtersJson: request.body.filtersJson,
      isShared: request.body.isShared
    });
    response.status(201).json(result);
  },

  async patch(request: Request, response: Response) {
    const result = await savedViewsService.update(String(request.params.id), request.user!.id, {
      name: request.body.name,
      filtersJson: request.body.filtersJson,
      isShared: request.body.isShared
    });
    response.status(200).json(result);
  },

  async remove(request: Request, response: Response) {
    await savedViewsService.remove(String(request.params.id), request.user!.id, request.user!.role);
    response.status(204).send();
  }
};
