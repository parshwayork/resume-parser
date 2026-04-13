export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface JobDescriptionSignals {
  must_haves: string[];
  nice_to_haves: string[];
  seniority_level: "junior" | "mid" | "senior" | "staff" | "unknown";
  domain: string;
  role_title: string;
}

export interface ResumeSignals {
  skills: string[];
  titles: string[];
  years_of_experience: number | null;
  highlights: string[];
}

export interface ParseSuccessResult {
  success: true;
  text: string;
  warnings: string[];
}

export interface ParseFailureResult {
  success: false;
  reason: string;
}

export type ParseResult = ParseSuccessResult | ParseFailureResult;

export interface ParsedDocument {
  filePath: string;
  fileName: string;
  rawText: string;
  sha256: string;
  wasTruncated: boolean;
  warnings: string[];
}

export interface CandidateRecord {
  parsed: ParsedDocument;
  signals: ResumeSignals;
  embedding: number[];
  summaryEmbedding: number[];
}

export interface SubScores {
  must_have_overlap: number;
  embedding_similarity: number;
  nice_to_have_overlap: number;
  missing_must_have_penalty: number;
  seniority_misalignment_penalty: number;
}

export interface RankedCandidate {
  rank: number;
  file: string;
  final_score: number;
  sub_scores: SubScores;
  matched_must_haves: string[];
  missing_must_haves: string[];
  matched_nice_to_haves: string[];
  reason: string;
}

export interface SkippedFile {
  file: string;
  reason: string;
}

export type ScoringMode = "full" | "embedding_only";

export interface RankedOutput {
  job_title: string;
  jd_file: string;
  generated_at: string;
  total_candidates_evaluated: number;
  total_valid_candidates: number;
  scoring_mode: ScoringMode;
  top_candidates: RankedCandidate[];
  skipped: SkippedFile[];
}

export interface JobRecord {
  runId: string;
  status: JobStatus;
  createdAt: string;
  completedAt?: string;
  result?: RankedOutput;
  error?: string;
}

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

