import express from "express";
import { errorHandler } from "./middleware/errorHandler";
import { requestLogger } from "./middleware/requestLogger";
import { healthRouter } from "./routes/healthRouter";
import { rankingsRouter } from "./routes/rankingsRouter";

export const createApp = () => {
  const app = express();

  app.use(express.json({ limit: "1mb" }));
  app.use(requestLogger);
  app.use("/api/v1", healthRouter);
  app.use("/api/v1", rankingsRouter);
  app.use(errorHandler);

  return app;
};

