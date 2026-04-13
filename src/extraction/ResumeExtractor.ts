import { z } from "zod";
import { config } from "../config/env";
import { models } from "../config/models";
import { ExtractionError } from "../errors/AppError";
import { ResumeSignals } from "../types";
import { withRetry } from "../utils/retry";
import { normalize, truncateForModel } from "../utils/text";
import { getOpenAiClient } from "./openaiClient";
import { resumePrompt } from "./prompts";

const resumeSignalsSchema = z.object({
  skills: z.array(z.string()).default([]),
  titles: z.array(z.string()).default([]),
  years_of_experience: z.number().nullable().default(null),
  highlights: z.array(z.string()).max(3).default([])
});

const resumeJsonSchema = {
  name: "resume_signals",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      skills: { type: "array", items: { type: "string" } },
      titles: { type: "array", items: { type: "string" } },
      years_of_experience: {
        anyOf: [{ type: "number" }, { type: "null" }]
      },
      highlights: { type: "array", items: { type: "string" }, maxItems: 3 }
    },
    required: ["skills", "titles", "years_of_experience", "highlights"]
  }
} as const;

export interface ResumeExtractionResult {
  signals: ResumeSignals;
  wasTruncated: boolean;
}

const uniqueStrings = (values: string[]): string[] =>
  Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  );

export class ResumeExtractor {
  public async extract(rawText: string): Promise<ResumeExtractionResult> {
    const { text, wasTruncated } = truncateForModel(rawText);

    const completion = await withRetry(
      async () =>
        getOpenAiClient().chat.completions.create({
          model: models.extractionChatModel,
          temperature: 0,
          response_format: {
            type: "json_schema",
            json_schema: resumeJsonSchema
          } as never,
          messages: [
            { role: "system", content: resumePrompt },
            { role: "user", content: text }
          ]
        }),
      {
        maxAttempts: 3,
        initialBackoffMs: 1_000,
        label: "resume-extract",
        timeoutMs: config.openAiTimeoutMs
      }
    );

    const content = completion.choices[0]?.message?.content;

    if (!content) {
      throw new ExtractionError(
        "Resume extraction returned empty response",
        "RESUME_EXTRACTION_EMPTY",
        500
      );
    }

    try {
      const parsed = resumeSignalsSchema.parse(JSON.parse(content));
      const normalizedRawText = normalize(rawText);
      const groundedSkills = parsed.skills.filter((skill) =>
        normalizedRawText.includes(normalize(skill))
      );

      return {
        wasTruncated,
        signals: {
          skills: uniqueStrings(groundedSkills),
          titles: uniqueStrings(parsed.titles),
          years_of_experience: parsed.years_of_experience,
          highlights: uniqueStrings(parsed.highlights).slice(0, 3)
        }
      };
    } catch (error) {
      throw new ExtractionError(
        `Resume extraction JSON parse failed: ${(error as Error).message}`,
        "RESUME_EXTRACTION_INVALID_JSON",
        500
      );
    }
  }
}

