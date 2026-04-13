import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../config/env";
import { models } from "../config/models";
import { EmbeddingError } from "../errors/AppError";
import { withRetry } from "../utils/retry";
import { getOpenAiClient } from "../extraction/openaiClient";

type EmbeddingCache = Record<string, number[]>;

let cacheWriteLock: Promise<void> = Promise.resolve();

const withCacheWriteLock = async (write: () => Promise<void>): Promise<void> => {
  cacheWriteLock = cacheWriteLock.then(write);
  await cacheWriteLock;
};

export class EmbeddingService {
  private readonly cacheFilePath = path.join(
    config.outputDir,
    config.embeddingCacheFileName
  );

  private cache: EmbeddingCache | null = null;

  private async loadCache(): Promise<EmbeddingCache> {
    if (this.cache) {
      return this.cache;
    }

    try {
      const fileContent = await fs.readFile(this.cacheFilePath, "utf8");
      const parsed = JSON.parse(fileContent) as EmbeddingCache;
      this.cache = parsed;
      return parsed;
    } catch {
      this.cache = {};
      return this.cache;
    }
  }

  private async persistCache(cache: EmbeddingCache): Promise<void> {
    await withCacheWriteLock(async () => {
      await fs.mkdir(config.outputDir, { recursive: true });
      const tempFilePath = `${this.cacheFilePath}.tmp-${process.pid}-${Date.now()}`;
      await fs.writeFile(tempFilePath, JSON.stringify(cache), "utf8");
      await fs.rename(tempFilePath, this.cacheFilePath);
    });
  }

  public async getEmbedding(text: string, key: string): Promise<number[]> {
    const cache = await this.loadCache();
    const cachedValue = cache[key];

    if (Array.isArray(cachedValue) && cachedValue.length > 0) {
      return cachedValue;
    }

    if (cachedValue && !Array.isArray(cachedValue)) {
      console.warn(`[embedding-cache] Corrupted entry key=${key}, recomputing`);
      delete cache[key];
      await this.persistCache(cache);
    }

    const response = await withRetry(
      async () =>
        getOpenAiClient().embeddings.create({
          model: models.embeddingModel,
          input: text
        }),
      {
        maxAttempts: 3,
        initialBackoffMs: 1_000,
        label: "embed",
        timeoutMs: config.openAiTimeoutMs
      }
    );

    const embedding = response.data[0]?.embedding;
    if (!embedding) {
      throw new EmbeddingError(
        "Embedding API returned empty vector",
        "EMBEDDING_EMPTY",
        500
      );
    }

    cache[key] = embedding;
    await this.persistCache(cache);

    return embedding;
  }
}

