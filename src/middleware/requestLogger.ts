import { NextFunction, Request, Response } from "express";

export const requestLogger = (
  request: Request,
  response: Response,
  next: NextFunction
): void => {
  const startTime = Date.now();
  response.on("finish", () => {
    console.log(
      `[http] method=${request.method} path=${request.path} status=${response.statusCode} durationMs=${Date.now() - startTime}`
    );
  });
  next();
};

