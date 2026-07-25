import type { AlertStatus } from "@prisma/client";
import type { Request, Response } from "express";

import { alertsService } from "./alerts.service.js";

export const alertsController = {
  async listRules(_request: Request, response: Response) {
    response.status(200).json(await alertsService.listRules());
  },

  async createRule(request: Request, response: Response) {
    const rule = await alertsService.createRule({
      name: request.body.name,
      metricType: request.body.metricType,
      comparator: request.body.comparator,
      threshold: request.body.threshold,
      windowMinutes: request.body.windowMinutes,
      createdById: request.user!.id
    });

    response.status(201).json(rule);
  },

  async patchRule(request: Request, response: Response) {
    const rule = await alertsService.updateRule(
      String(request.params.id),
      request.body,
      request.user!.id
    );
    response.status(200).json(rule);
  },

  async deleteRule(request: Request, response: Response) {
    await alertsService.deleteRule(String(request.params.id), request.user!.id);
    response.status(204).send();
  },

  async listEvents(request: Request, response: Response) {
    const events = await alertsService.listEvents({
      status: request.query.status ? (String(request.query.status) as AlertStatus) : undefined,
      limit: request.query.limit ? Number(request.query.limit) : undefined
    });
    response.status(200).json(events);
  },

  async acknowledge(request: Request, response: Response) {
    const event = await alertsService.acknowledge(String(request.params.id), request.user!.id);
    response.status(200).json(event);
  }
};
