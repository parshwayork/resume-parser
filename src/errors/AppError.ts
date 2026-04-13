export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly context?: Record<string, unknown>;

  public constructor(
    message: string,
    code: string,
    statusCode: number,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;
  }
}

export class ParseError extends AppError {}
export class ExtractionError extends AppError {}
export class EmbeddingError extends AppError {}
export class ConfigError extends AppError {}

