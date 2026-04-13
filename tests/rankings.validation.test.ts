import request from "supertest";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

describe("rankings endpoint validation", () => {
  it("returns 400 when body is invalid", async () => {
    const app = createApp();
    const response = await request(app).post("/api/v1/rankings").send({});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when jdPath is not a file", async () => {
    const app = createApp();
    const response = await request(app).post("/api/v1/rankings").send({
      jdPath: path.resolve(process.cwd(), "inputs", "resumes"),
      resumesDir: path.resolve(process.cwd(), "inputs", "resumes"),
      concurrency: 1
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_JD_PATH");
  });

  it("returns 400 when resumesDir is not a directory", async () => {
    const app = createApp();
    const response = await request(app).post("/api/v1/rankings").send({
      jdPath: path.resolve(process.cwd(), "inputs", "job-description.docx"),
      resumesDir: path.resolve(process.cwd(), "inputs", "job-description.docx"),
      concurrency: 1
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_RESUMES_DIR");
  });
});

