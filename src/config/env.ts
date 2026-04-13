import dotenv from "dotenv";
import path from "node:path";

dotenv.config();

const openAiApiKey = process.env.OPENAI_API_KEY;

const portRaw = process.env.PORT ?? "3000";
const port = Number(portRaw);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("PORT must be a positive integer");
}

export const config = {
  openAiApiKey,
  port,
  defaultConcurrency: 3,
  maxConcurrency: 10,
  rerankCandidateWindow: 30,
  finalTopCandidates: 10,
  openAiTimeoutMs: 30_000,
  maxCharactersBeforeTruncate: 24_000,
  truncateChunkCharacters: 12_000,
  minPdfCharacters: 200,
  minResumeCharacters: 200,
  outputDir: path.resolve(process.cwd(), "output"),
  embeddingCacheFileName: ".embedding-cache.json",
  topCandidatesLimit: 10
} as const;

