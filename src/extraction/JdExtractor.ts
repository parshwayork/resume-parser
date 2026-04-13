import { z } from "zod";
import { config } from "../config/env";
import { models } from "../config/models";
import { ExtractionError } from "../errors/AppError";
import { JobDescriptionSignals } from "../types";
import { withRetry } from "../utils/retry";
import { truncateForModel } from "../utils/text";
import { getOpenAiClient } from "./openaiClient";
import { jobDescriptionPrompt } from "./prompts";

const jdSignalsSchema = z.object({
  must_haves: z.array(z.string()).default([]),
  nice_to_haves: z.array(z.string()).default([]),
  seniority_level: z
    .enum(["junior", "mid", "senior", "staff", "unknown"])
    .default("unknown"),
  domain: z.string().default("unknown"),
  role_title: z.string().default("unknown")
});

const jdJsonSchema = {
  name: "job_description_signals",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      must_haves: { type: "array", items: { type: "string" } },
      nice_to_haves: { type: "array", items: { type: "string" } },
      seniority_level: {
        type: "string",
        enum: ["junior", "mid", "senior", "staff", "unknown"]
      },
      domain: { type: "string" },
      role_title: { type: "string" }
    },
    required: [
      "must_haves",
      "nice_to_haves",
      "seniority_level",
      "domain",
      "role_title"
    ]
  }
} as const;

export interface JdExtractionResult {
  signals: JobDescriptionSignals;
  wasTruncated: boolean;
}

export class JdExtractor {
  public async extract(rawText: string): Promise<JdExtractionResult> {
    const { text, wasTruncated } = truncateForModel(rawText);

    const completion = await withRetry(
      async () =>
        getOpenAiClient().chat.completions.create({
          model: models.extractionChatModel,
          temperature: 0,
          response_format: {
            type: "json_schema",
            json_schema: jdJsonSchema
          } as never,
          messages: [
            { role: "system", content: jobDescriptionPrompt },
            { role: "user", content: text }
          ]
        }),
      {
        maxAttempts: 3,
        initialBackoffMs: 1_000,
        label: "jd-extract",
        timeoutMs: config.openAiTimeoutMs
      }
    );

    const content = completion.choices[0]?.message?.content;

    if (!content) {
      throw new ExtractionError(
        "JD extraction returned empty response",
        "JD_EXTRACTION_EMPTY",
        500
      );
    }

    try {
      const parsed = JSON.parse(content);
      const signals = jdSignalsSchema.parse(parsed);

      return { signals, wasTruncated };
    } catch (error) {
      throw new ExtractionError(
        `JD extraction JSON parse failed: ${(error as Error).message}`,
        "JD_EXTRACTION_INVALID_JSON",
        500
      );
    }
  }
}

