import { promises as fs } from "node:fs";
import { config } from "../config/env";
import { ParseResult } from "../types";
import { DocumentParser } from "./types";

export class PdfParser implements DocumentParser {
  public readonly supportedExtensions = [".pdf"] as const;

  public async parse(filePath: string): Promise<ParseResult> {
    try {
      const pdfParseModule = await import("pdf-parse");
      const parsePdf =
        (pdfParseModule as unknown as { default?: (input: Buffer) => Promise<{ text: string }> })
          .default ??
        (pdfParseModule as unknown as (input: Buffer) => Promise<{ text: string }>);
      const fileBuffer = await fs.readFile(filePath);
      const parsed = await parsePdf(fileBuffer);
      const cleanedText = parsed.text.trim();

      if (cleanedText.length < config.minPdfCharacters) {
        return {
          success: false,
          reason: "PDF appears to be image-based (OCR not supported)"
        };
      }

      return { success: true, text: cleanedText, warnings: [] };
    } catch (error) {
      return {
        success: false,
        reason: `PDF parse error: ${(error as Error).message}`
      };
    }
  }
}

