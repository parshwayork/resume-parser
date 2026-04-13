import path from "node:path";
import { ParseResult } from "../types";
import { DocumentParser } from "./types";

export class ParserRegistry {
  private readonly parserByExtension: Map<string, DocumentParser>;

  public constructor(parsers: DocumentParser[]) {
    this.parserByExtension = new Map<string, DocumentParser>();

    for (const parser of parsers) {
      for (const extension of parser.supportedExtensions) {
        this.parserByExtension.set(extension.toLowerCase(), parser);
      }
    }
  }

  public async parse(filePath: string): Promise<ParseResult> {
    const extension = path.extname(filePath).toLowerCase();
    const parser = this.parserByExtension.get(extension);

    if (!parser) {
      return {
        success: false,
        reason: `Unsupported file format: ${extension || "unknown"}`
      };
    }

    return parser.parse(filePath);
  }
}

