import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { createJob, getJob, updateJobStatus } from "../jobs/jobStore";
import { runRankingPipeline } from "../pipeline/runRankingPipeline";
import { validateBody } from "../middleware/validateBody";
import { config } from "../config/env";

const createRankingRequestSchema = z.object({
  jdPath: z.string().min(1, "jdPath is required"),
  resumesDir: z.string().min(1, "resumesDir is required"),
  concurrency: z.number().int().min(1).max(config.maxConcurrency).default(3)
});

export const rankingsRouter = Router();

const isSupportedJdExtension = (jdPath: string): boolean =>
  [".pdf", ".docx"].includes(path.extname(jdPath).toLowerCase());

rankingsRouter.post(
  "/rankings",
  validateBody(createRankingRequestSchema),
  async (request, response) => {
    const { jdPath, resumesDir, concurrency } = request.body as z.infer<
      typeof createRankingRequestSchema
    >;

    try {
      const jdStats = await fs.stat(jdPath);
      const resumesDirStats = await fs.stat(resumesDir);

      if (!jdStats.isFile()) {
        response.status(400).json({
          success: false,
          error: {
            code: "INVALID_JD_PATH",
            message: "jdPath must be an existing file"
          }
        });
        return;
      }

      if (!isSupportedJdExtension(jdPath)) {
        response.status(400).json({
          success: false,
          error: {
            code: "UNSUPPORTED_JD_FORMAT",
            message: "jdPath must be a .pdf or .docx file"
          }
        });
        return;
      }

      if (!resumesDirStats.isDirectory()) {
        response.status(400).json({
          success: false,
          error: {
            code: "INVALID_RESUMES_DIR",
            message: "resumesDir must be an existing directory"
          }
        });
        return;
      }
    } catch (error) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_PATH",
          message: `jdPath or resumesDir is invalid: ${(error as Error).message}`
        }
      });
      return;
    }

    const runId = randomUUID();
    createJob(runId);

    void (async () => {
      updateJobStatus(runId, "running");
      try {
        const result = await runRankingPipeline({ jdPath, resumesDir, concurrency });
        updateJobStatus(runId, "completed", { result });
      } catch (error) {
        updateJobStatus(runId, "failed", { error: (error as Error).message });
      }
    })();

    response.status(202).json({
      success: true,
      data: {
        runId,
        status: "queued",
        statusUrl: `/api/v1/rankings/${runId}`
      }
    });
  }
);

rankingsRouter.get("/rankings/:runId", (request, response) => {
  const { runId } = request.params;
  const job = getJob(runId);

  if (!job) {
    response.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "runId not found"
      }
    });
    return;
  }

  if (job.status === "failed") {
    response.status(200).json({
      success: false,
      data: {
        runId: job.runId,
        status: job.status,
        error: job.error
      }
    });
    return;
  }

  if (job.status === "completed") {
    response.status(200).json({
      success: true,
      data: {
        runId: job.runId,
        status: job.status,
        result: job.result
      }
    });
    return;
  }

  response.status(200).json({
    success: true,
    data: {
      runId: job.runId,
      status: job.status
    }
  });
});

