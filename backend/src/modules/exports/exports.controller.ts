import type { Request, Response } from "express";
import { createReadStream } from "node:fs";

import { AppError } from "../../shared/errors/AppError.js";
import { ERROR_CODES } from "../../shared/errors/errorCodes.js";
import { exportsService } from "./exports.service.js";

export const exportsController = {
  async create(request: Request, response: Response) {
    const result = await exportsService.create({
      requestedById: request.user!.id,
      requestedByRole: request.user!.role,
      exportType: request.body.exportType,
      filters: request.body.filters
    });

    response.status(201).json(result);
  },

  async estimate(request: Request, response: Response) {
    const result = await exportsService.estimate(request.body.exportType, request.body.filters);
    response.status(200).json(result);
  },

  async list(request: Request, response: Response) {
    // ?all=true is honoured only for admins; anyone else silently gets their
    // own list rather than an error, because asking is not misbehaviour.
    const includeAllUsers = request.query.all === "true" && request.user!.role === "SYSTEM_ADMIN";
    const result = await exportsService.listForUser(request.user!.id, { includeAllUsers });
    response.status(200).json(result);
  },

  async getById(request: Request, response: Response) {
    const result = await exportsService.getById(
      request.user!.id,
      String(request.params.id),
      request.user!.role
    );
    response.status(200).json(result);
  },

  async retry(request: Request, response: Response) {
    const result = await exportsService.retry(
      request.user!.id,
      String(request.params.id),
      request.user!.role
    );
    response.status(200).json(result);
  },

  async download(request: Request, response: Response, next: (error?: unknown) => void) {
    const file = await exportsService.downloadForUser(
      request.user!.id,
      String(request.params.id),
      request.user!.role
    );

    const stream = createReadStream(file.filePath);

    /**
     * The stream had no error handler, so a missing file produced an unhandled
     * error event mid-response rather than a usable status. The seed used to
     * create exactly that state — rows naming files that were never written.
     *
     * Headers are only set once the stream opens; setting them up front and
     * then failing would leave a 200 with a truncated body, which looks to a
     * client like a successful but corrupt download.
     */
    stream.on("open", () => {
      response.setHeader("content-type", "text/csv; charset=utf-8");
      response.setHeader("content-disposition", `attachment; filename="${file.fileName}"`);
    });

    stream.on("error", (error: NodeJS.ErrnoException) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }

      next(
        error.code === "ENOENT"
          ? new AppError(
              ERROR_CODES.NOT_FOUND,
              "Export file is no longer available. Run the export again.",
              404
            )
          : error
      );
    });

    stream.pipe(response);
  }
};
