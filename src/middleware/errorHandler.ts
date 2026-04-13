import { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/AppError";

export const errorHandler = (
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction
): void => {
  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message
      }
    });
    return;
  }

  const genericError = error as Error;
  response.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: genericError.message || "Unexpected error"
    }
  });
};

