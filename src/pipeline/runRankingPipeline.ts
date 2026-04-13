import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../config/env";
import { ExtractionError, ParseError } from "../errors/AppError";
import { EmbeddingService } from "../embeddings/EmbeddingService";
import { JdExtractor } from "../extraction/JdExtractor";
import { ResumeExtractor } from "../extraction/ResumeExtractor";
import { OutputWriter } from "../output/OutputWriter";
import { DocxParser } from "../parsers/DocxParser";
import { ParserRegistry } from "../parsers/ParserRegistry";
import { PdfParser } from "../parsers/PdfParser";
import { ScoringEngine } from "../scoring/ScoringEngine";
import { Reranker } from "../scoring/Reranker";
import {
  CandidateRecord,
  ParsedDocument,
  RankedOutput,
  ScoringMode,
  SkippedFile
} from "../types";
import { sha256 } from "../utils/hash";
import { basename } from "../utils/text";

const SUPPORTED_EXTENSIONS = new Set([".pdf", ".docx"]);

const getSupportedFilesInDirectory = async (directoryPath: string): Promise<string[]> => {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(directoryPath, entry.name))
    .filter((filePath) =>
      SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase())
    );
};

const mapParsedDocument = (params: {
  filePath: string;
  text: string;
  warnings: string[];
}): ParsedDocument => ({
  filePath: params.filePath,
  fileName: basename(params.filePath),
  rawText: params.text,
  sha256: sha256(params.text),
  wasTruncated: false,
  warnings: params.warnings
});

const buildJobSummaryText = (params: {
  roleTitle: string;
  domain: string;
  seniorityLevel: string;
  mustHaves: string[];
  niceToHaves: string[];
}): string =>
  [
    `Role: ${params.roleTitle}`,
    `Domain: ${params.domain}`,
    `Seniority: ${params.seniorityLevel}`,
    `Must-haves: ${params.mustHaves.join(", ")}`,
    `Nice-to-haves: ${params.niceToHaves.join(", ")}`
  ].join("\n");

const buildResumeSummaryText = (params: {
  skills: string[];
  titles: string[];
  highlights: string[];
  yearsOfExperience: number | null;
}): string =>
  [
    `Titles: ${params.titles.join(", ")}`,
    `Skills: ${params.skills.join(", ")}`,
    `Years of experience: ${params.yearsOfExperience ?? "unknown"}`,
    `Highlights: ${params.highlights.join(" | ")}`
  ].join("\n");

interface PipelineInput {
  jdPath: string;
  resumesDir: string;
  concurrency: number;
}

export const runRankingPipeline = async (
  input: PipelineInput
): Promise<RankedOutput> => {
  const parserRegistry = new ParserRegistry([new PdfParser(), new DocxParser()]);
  const jdExtractor = new JdExtractor();
  const resumeExtractor = new ResumeExtractor();
  const embeddingService = new EmbeddingService();
  const scoringEngine = new ScoringEngine();
  const reranker = new Reranker();
  const outputWriter = new OutputWriter();

  const skipped: SkippedFile[] = [];
  const { default: pLimit } = await import("p-limit");

  const jdParseResult = await parserRegistry.parse(input.jdPath);
  if (!jdParseResult.success) {
    throw new ParseError(
      `JD parse failed: ${jdParseResult.reason}`,
      "JD_PARSE_FAILED",
      500
    );
  }

  const jdExtraction = await jdExtractor.extract(jdParseResult.text).catch((error) => {
    throw new ExtractionError(
      `JD extraction failed — cannot proceed without job signals. ${(error as Error).message}`,
      "JD_EXTRACTION_FAILED",
      500
    );
  });

  const jdEmbedding = await embeddingService.getEmbedding(
    jdParseResult.text,
    sha256(jdParseResult.text)
  );
  const jdSummaryText = buildJobSummaryText({
    roleTitle: jdExtraction.signals.role_title,
    domain: jdExtraction.signals.domain,
    seniorityLevel: jdExtraction.signals.seniority_level,
    mustHaves: jdExtraction.signals.must_haves,
    niceToHaves: jdExtraction.signals.nice_to_haves
  });
  const jdSummaryEmbedding = await embeddingService.getEmbedding(
    jdSummaryText,
    sha256(jdSummaryText)
  );

  const mode: ScoringMode =
    jdExtraction.signals.must_haves.length > 0 ? "full" : "embedding_only";
  if (mode === "embedding_only") {
    console.warn("[pipeline] sparse JD detected, switching to embedding_only mode");
  }

  const resumeFiles = await getSupportedFilesInDirectory(input.resumesDir);
  const uniqueParsedByHash = new Map<string, ParsedDocument>();

  for (const filePath of resumeFiles) {
    const parseResult = await parserRegistry.parse(filePath);

    if (!parseResult.success) {
      skipped.push({ file: basename(filePath), reason: parseResult.reason });
      continue;
    }

    if (parseResult.text.trim().length < config.minResumeCharacters) {
      skipped.push({ file: basename(filePath), reason: "Resume text too short" });
      continue;
    }

    const parsedDocument = mapParsedDocument({
      filePath,
      text: parseResult.text,
      warnings: parseResult.warnings
    });

    if (uniqueParsedByHash.has(parsedDocument.sha256)) {
      console.warn(
        `[pipeline] duplicate resume skipped file=${parsedDocument.fileName}`
      );
      continue;
    }

    uniqueParsedByHash.set(parsedDocument.sha256, parsedDocument);
  }

  const limit = pLimit(Math.min(Math.max(input.concurrency, 1), config.maxConcurrency));
  const candidatePromises = Array.from(uniqueParsedByHash.values()).map(
    (parsedDocument) =>
      limit(async (): Promise<CandidateRecord | null> => {
        try {
          const extractionResult = await resumeExtractor.extract(parsedDocument.rawText);
          const embedding = await embeddingService.getEmbedding(
            parsedDocument.rawText,
            parsedDocument.sha256
          );
          const summaryText = buildResumeSummaryText({
            skills: extractionResult.signals.skills,
            titles: extractionResult.signals.titles,
            highlights: extractionResult.signals.highlights,
            yearsOfExperience: extractionResult.signals.years_of_experience
          });
          const summaryEmbedding = await embeddingService.getEmbedding(
            summaryText,
            sha256(summaryText)
          );

          return {
            parsed: {
              ...parsedDocument,
              wasTruncated: extractionResult.wasTruncated
            },
            signals: extractionResult.signals,
            embedding,
            summaryEmbedding
          };
        } catch (error) {
          skipped.push({
            file: parsedDocument.fileName,
            reason: (error as Error).message
          });
          return null;
        }
      })
  );

  const candidateRecords = (await Promise.all(candidatePromises)).filter(
    (candidate): candidate is CandidateRecord => candidate !== null
  );

  const rankedCandidates = scoringEngine
    .scoreCandidates({
      candidates: candidateRecords,
      jdSignals: jdExtraction.signals,
      jdEmbedding,
      jdSummaryEmbedding,
      mode
    });

  const rerankWindow = rankedCandidates.slice(0, config.rerankCandidateWindow);
  const rerankedTopCandidates = await reranker.rerank({
    jobTitle: jdExtraction.signals.role_title,
    candidates: rerankWindow,
    finalCount: config.finalTopCandidates
  });

  const rankedOutput: RankedOutput = {
    job_title: jdExtraction.signals.role_title,
    jd_file: basename(input.jdPath),
    generated_at: new Date().toISOString(),
    total_candidates_evaluated: resumeFiles.length,
    total_valid_candidates: candidateRecords.length,
    scoring_mode: mode,
    top_candidates: rerankedTopCandidates,
    skipped
  };

  await outputWriter.write({ rankedOutput, skipped });
  return rankedOutput;
};

