import { ParseResult } from "../types";

export interface DocumentParser {
  readonly supportedExtensions: readonly string[];
  parse(filePath: string): Promise<ParseResult>;
}

