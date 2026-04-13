import path from "node:path";
import { config } from "../config/env";

export interface TruncateResult {
  text: string;
  wasTruncated: boolean;
}

export const truncateForModel = (text: string): TruncateResult => {
  if (text.length <= config.maxCharactersBeforeTruncate) {
    return { text, wasTruncated: false };
  }

  const first = text.slice(0, config.truncateChunkCharacters);
  const last = text.slice(-config.truncateChunkCharacters);

  return {
    text: `${first}\n[...middle section truncated...]\n${last}`,
    wasTruncated: true
  };
};

export const normalize = (text: string): string => text.toLowerCase().trim();

export const basename = (filePath: string): string => path.basename(filePath);

