import { describe, expect, it, vi } from "vitest";

const mockChatCreate = vi.fn();

vi.mock("../src/extraction/openaiClient", () => ({
  getOpenAiClient: () => ({
    chat: {
      completions: {
        create: mockChatCreate
      }
    }
  })
}));

import { Reranker } from "../src/scoring/Reranker";
import { RankedCandidate } from "../src/types";

const candidate = (file: string, rank: number): RankedCandidate => ({
  rank,
  file,
  final_score: 0.9 - rank * 0.1,
  sub_scores: {
    must_have_overlap: 0.5,
    embedding_similarity: 0.5,
    nice_to_have_overlap: 0.1,
    missing_must_have_penalty: -0.1,
    seniority_misalignment_penalty: 0
  },
  matched_must_haves: [],
  missing_must_haves: [],
  matched_nice_to_haves: [],
  reason: "test"
});

describe("reranker", () => {
  it("falls back to algorithmic ordering when rerank response is invalid", async () => {
    mockChatCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "not-json" } }]
    });

    const reranker = new Reranker();
    const input = [candidate("a.pdf", 1), candidate("b.pdf", 2)];
    const output = await reranker.rerank({
      jobTitle: "Engineer",
      candidates: input,
      finalCount: 2
    });

    expect(output.map((item) => item.file)).toEqual(["a.pdf", "b.pdf"]);
  });
});

