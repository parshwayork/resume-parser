import { NextFunction, Request, Response } from "express";
import { ZodSchema } from "zod";

export const validateBody =
  <T>(schema: ZodSchema<T>) =>
  (request: Request, response: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues.map((issue) => issue.message).join("; ")
        }
      });
      return;
    }

    request.body = parsed.data;
    next();
  };

