import { z } from "zod";
import { config } from "../config/env";
import { models } from "../config/models";
import { RankedCandidate } from "../types";
import { withRetry } from "../utils/retry";
import { getOpenAiClient } from "../extraction/openaiClient";

const rerankSchema = z.object({
  ordered_files: z.array(z.string())
});

const rerankJsonSchema = {
  name: "candidate_rerank",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      ordered_files: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: ["ordered_files"]
  }
} as const;

const rerankPrompt = `You are ranking candidates for a job.
Output JSON only with ordered_files: string[].
Rules:
- Use evidence quality first: must-have coverage, seniority alignment, and concrete match reasons.
- Prefer candidates with fewer missing must-haves.
- Keep deterministic ordering for ties by preserving existing order.
- Return only filenames from the provided list.`;

export class Reranker {
  public async rerank(params: {
    jobTitle: string;
    candidates: RankedCandidate[];
    finalCount: number;
  }): Promise<RankedCandidate[]> {
    if (params.candidates.length <= 1) {
      return params.candidates.slice(0, params.finalCount);
    }

    try {
      const completion = await withRetry(
        async () =>
          getOpenAiClient().chat.completions.create({
            model: models.rerankChatModel,
            temperature: 0,
            response_format: {
              type: "json_schema",
              json_schema: rerankJsonSchema
            } as never,
            messages: [
              { role: "system", content: rerankPrompt },
              {
                role: "user",
                content: JSON.stringify({
                  job_title: params.jobTitle,
                  candidates: params.candidates.map((candidate) => ({
                    file: candidate.file,
                    final_score: candidate.final_score,
                    matched_must_haves: candidate.matched_must_haves,
                    missing_must_haves: candidate.missing_must_haves,
                    reason: candidate.reason
                  }))
                })
              }
            ]
          }),
        {
          maxAttempts: 2,
          initialBackoffMs: 1_000,
          label: "rerank",
          timeoutMs: config.openAiTimeoutMs
        }
      );

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        return params.candidates.slice(0, params.finalCount);
      }

      const parsed = rerankSchema.parse(JSON.parse(content));
      const preferredOrder = new Map(
        parsed.ordered_files.map((file, index) => [file, index] as const)
      );

      const reordered = [...params.candidates].sort((left, right) => {
        const leftOrder = preferredOrder.get(left.file);
        const rightOrder = preferredOrder.get(right.file);
        if (leftOrder === undefined && rightOrder === undefined) {
          return left.rank - right.rank;
        }
        if (leftOrder === undefined) {
          return 1;
        }
        if (rightOrder === undefined) {
          return -1;
        }
        return leftOrder - rightOrder;
      });

      return reordered.slice(0, params.finalCount).map((candidate, index) => ({
        ...candidate,
        rank: index + 1
      }));
    } catch {
      return params.candidates.slice(0, params.finalCount);
    }
  }
}

