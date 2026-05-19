import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "#infrastructure/config/logger";
import { DomainError } from "#domain/errors/DomainError";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof DomainError) {
    logger.warn({ err }, "Domain error");
    return res
      .status(err.status)
      .json({ code: err.code, message: err.message });
  }

  if (err instanceof ZodError) {
    logger.warn({ err }, "Validation error");
    return res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "Validation failed",
      details: err.flatten(),
    });
  }

  logger.error({ err }, "Request failed");
  res
    .status(500)
    .json({ code: "INTERNAL_ERROR", message: "Internal server error" });
}
