import OpenAI from "openai";
import { config } from "../config/env";
import { ConfigError } from "../errors/AppError";

let openAiClient: OpenAI | null = null;

export const getOpenAiClient = (): OpenAI => {
  if (!config.openAiApiKey) {
    throw new ConfigError(
      "OPENAI_API_KEY not set in environment",
      "OPENAI_KEY_MISSING",
      500
    );
  }

  if (!openAiClient) {
    openAiClient = new OpenAI({
      apiKey: config.openAiApiKey
    });
  }

  return openAiClient;
};

