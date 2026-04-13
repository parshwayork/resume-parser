import { promises as fs } from "node:fs";
import mammoth from "mammoth";
import { ParseResult } from "../types";
import { DocumentParser } from "./types";

export class DocxParser implements DocumentParser {
  public readonly supportedExtensions = [".docx"] as const;

  public async parse(filePath: string): Promise<ParseResult> {
    try {
      const buffer = await fs.readFile(filePath);
      const result = await mammoth.extractRawText({ buffer });
      const cleanedText = result.value.trim();

      return {
        success: true,
        text: cleanedText,
        warnings: result.messages.map((message) => message.message)
      };
    } catch (error) {
      return {
        success: false,
        reason: `DOCX parse error: ${(error as Error).message}`
      };
    }
  }
}

