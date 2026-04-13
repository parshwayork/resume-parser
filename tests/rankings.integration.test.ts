import path from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockChatCreate = vi.fn();
const mockEmbeddingsCreate = vi.fn();

vi.mock("../src/extraction/openaiClient", () => ({
  getOpenAiClient: () => ({
    chat: {
      completions: {
        create: mockChatCreate
      }
    },
    embeddings: {
      create: mockEmbeddingsCreate
    }
  })
}));

import { createApp } from "../src/app";

const jdSignals = {
  must_haves: ["Node.js", "PostgreSQL"],
  nice_to_haves: ["Redis"],
  seniority_level: "senior",
  domain: "backend",
  role_title: "Senior Backend Engineer"
};

const resumeSignals = {
  skills: ["Node.js", "PostgreSQL"],
  titles: ["Backend Engineer"],
  years_of_experience: 5,
  highlights: ["Built APIs"]
};

describe("rankings integration", () => {
  beforeEach(() => {
    mockChatCreate.mockReset();
    mockEmbeddingsCreate.mockReset();

    let chatCallCount = 0;
    mockChatCreate.mockImplementation(async () => {
      chatCallCount += 1;
      if (chatCallCount === 1) {
        return {
          choices: [{ message: { content: JSON.stringify(jdSignals) } }]
        };
      }

      return {
        choices: [{ message: { content: JSON.stringify(resumeSignals) } }]
      };
    });

    mockEmbeddingsCreate.mockImplementation(async () => ({
      data: [{ embedding: [1, 0, 0.5] }]
    }));
  });

  it("creates and completes a ranking run", async () => {
    const app = createApp();

    const jdPath = path.resolve(
      process.cwd(),
      "inputs",
      "job-description.docx"
    );
    const resumesDir = path.resolve(process.cwd(), "inputs", "resumes");

    const createResponse = await request(app)
      .post("/api/v1/rankings")
      .send({ jdPath, resumesDir, concurrency: 2 });

    expect(createResponse.status).toBe(202);
    expect(createResponse.body.success).toBe(true);
    const runId = createResponse.body.data.runId as string;
    expect(typeof runId).toBe("string");
    expect(runId.length).toBeGreaterThan(0);

    let latestPollBody: unknown = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const pollResponse = await request(app).get(`/api/v1/rankings/${runId}`);
      expect(pollResponse.status).toBe(200);
      latestPollBody = pollResponse.body;

      if (pollResponse.body?.data?.status === "completed") {
        break;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }

    expect((latestPollBody as { data?: { status?: string } }).data?.status).toBe(
      "completed"
    );
    expect(
      (latestPollBody as { data?: { result?: { top_candidates?: unknown[] } } }).data
        ?.result?.top_candidates?.length
    ).toBeGreaterThan(0);
  });
});

