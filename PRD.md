# PRD — Talent Intelligence & Ranking Engine (POC)

## 1. Problem

Keyword matching produces poor candidate-to-role fit. Goal: given one job description and a
local corpus of resumes (PDF/DOCX), produce a ranked Top-10 candidate list with per-candidate
scores, sub-scores, and human-readable match reasons. Runs entirely on a local machine.
OpenAI API required for extraction and embeddings.

---

## 2. Scope

### In Scope
- Expose pipeline functionality via a thin HTTP REST API (Express).
- Accept JD file path + resumes directory path as JSON body; return a run ID immediately.
- Parse PDF and DOCX to plain text via pluggable parsers.
- Extract structured signals from JD and each resume via OpenAI (structured JSON output, temperature 0).
- Generate embeddings for JD and each resume (OpenAI `text-embedding-3-large`).
- Score and rank candidates using a defined weighted formula.
- Store job state + results in-memory (Map keyed by run ID); persist ranked + skipped to `output/` as JSON files.
- Describe production architecture and known failure modes in `DESIGN.md`.
- Include AI interaction log in the repo.

### Out of Scope
- Cloud infra (S3, SQS, RDS) — documented in `DESIGN.md` as scaling path only.
- OCR for image-based/scanned PDFs — treated as parse failure, logged, not silently skipped.
- Authentication, UI, database, feedback loop, or historical match signals.
- Non-English documents.
- Multi-JD batch runs.

---

## 3. HTTP API Interface

The server starts with:

```bash
OPENAI_API_KEY=sk-... node dist/server.js
# Listening on http://localhost:3000
```

The README must include the exact `curl` commands to reproduce the evaluator's run against
the provided sample inputs.

### Endpoints

#### `POST /api/v1/rankings`

Triggers a new ranking run. Returns immediately with a `runId`; processing happens
asynchronously in the background.

**Request body**:
```json
{
  "jdPath": "./inputs/job-description.pdf",
  "resumesDir": "./inputs/resumes/",
  "concurrency": 3
}
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `jdPath` | `string` | Yes | — | Absolute or relative path to JD file (PDF or DOCX) |
| `resumesDir` | `string` | Yes | — | Directory containing resume files |
| `concurrency` | `number` | No | `3` | Max parallel OpenAI calls (1–10) |

**Response `202 Accepted`**:
```json
{
  "success": true,
  "data": {
    "runId": "a3f2c1d4-...",
    "status": "queued",
    "statusUrl": "/api/v1/rankings/a3f2c1d4-..."
  }
}
```

**Error responses**:
- `400` — missing/invalid `jdPath` or `resumesDir`, or `jdPath` file does not exist.
- `500` — unexpected server error.

---

#### `GET /api/v1/rankings/:runId`

Polls for job status and, when complete, returns the full ranked result.

**Response `200 OK` — while running**:
```json
{
  "success": true,
  "data": {
    "runId": "a3f2c1d4-...",
    "status": "running"
  }
}
```

**Response `200 OK` — on completion**:
```json
{
  "success": true,
  "data": {
    "runId": "a3f2c1d4-...",
    "status": "completed",
    "result": { ...RankedOutput }
  }
}
```

**Response `200 OK` — on failure**:
```json
{
  "success": false,
  "data": {
    "runId": "a3f2c1d4-...",
    "status": "failed",
    "error": "JD extraction failed — cannot proceed without job signals."
  }
}
```

**Error responses**:
- `404` — `runId` not found.

---

#### `GET /api/v1/health`

Liveness check. Returns `200` with `{ "status": "ok" }`. No dependencies checked.

---

### Response Envelope

All responses follow a consistent shape:

```typescript
type ApiResponse<T> =
  | { success: true;  data: T }
  | { success: false; error: { code: string; message: string } }
```

### Validation

All request bodies validated with `zod` at the route level before any pipeline code runs.
Invalid requests are rejected at the boundary with a `400` and a structured error body — no
validation logic leaks into services.

---

## 4. Architecture & Pipeline

```
HTTP Client (curl / Postman)
        │
        ▼
┌───────────────────────────────────────┐
│  Express Server  (server.ts)          │
│  POST /api/v1/rankings                │
│  GET  /api/v1/rankings/:runId         │
│  GET  /api/v1/health                  │
└──────────────────┬────────────────────┘
                   │  validates input (zod)
                   │  generates runId (uuid)
                   │  responds 202 immediately
                   │  fires pipeline async (no await)
                   ▼
┌───────────────────────────────────────┐
│  In-Memory Job Store                  │
│  Map<runId, JobRecord>                │
│  status: queued | running |           │
│          completed | failed           │
└──────────────────┬────────────────────┘
                   │
                   ▼
┌─────────────┐  ┌──────────────┐  ┌────────────────────┐
│ File Intake │─▶│ Parser Layer │─▶│  Extraction Layer  │
│ (from paths │  │ PDF / DOCX   │  │  OpenAI structured │
│  in request)│  │ pluggable    │  │  JSON output       │
└─────────────┘  └──────────────┘  └────────┬───────────┘
                                             │
                 ┌───────────────────────────▼───────────┐
                 │            Embedding Layer              │
                 │  text-embedding-3-small, cached        │
                 └───────────────────────────┬────────────┘
                                             │
                 ┌───────────────────────────▼───────────┐
                 │          Scoring & Ranking              │
                 │  Weighted formula → Top-10             │
                 └───────────────────────────┬────────────┘
                                             │
                 ┌───────────────────────────▼───────────┐
                 │            Output Writer               │
                 │  ranked-<ts>.json + skipped-<ts>.json │
                 │  updates Job Store → status: completed │
                 └────────────────────────────────────────┘
```

**Key design decision**: `POST /api/v1/rankings` responds `202` immediately and runs the
pipeline asynchronously. The caller polls `GET /api/v1/rankings/:runId` for the result.
This keeps the HTTP layer non-blocking and maps cleanly to the production model (SQS
enqueue → worker processes → result stored in DB).

### 4.1 Parser Layer

Interface (extensible without full rewrite):

```typescript
interface DocumentParser {
  readonly supportedExtensions: readonly string[];
  parse(filePath: string): Promise<ParseResult>;
}

type ParseResult =
  | { success: true; text: string; warnings: string[] }
  | { success: false; reason: string };
```

Implementations:
- `PdfParser` — uses `pdf-parse`. If extracted text < 200 characters, treat as image-based
  scan → return `success: false` with reason `"PDF appears to be image-based (OCR not supported)"`.
- `DocxParser` — uses `mammoth`. Strips markup, extracts raw text.
- `ParserRegistry` — maps file extension → parser. Unknown extension → `success: false` with
  reason `"Unsupported file format: <ext>"`.

### 4.2 Extraction Layer

**JD Extraction** — 1 OpenAI call per run (`gpt-4o`, temperature 0, strict JSON schema output):

```typescript
interface JobDescriptionSignals {
  must_haves: string[];
  nice_to_haves: string[];
  seniority_level: "junior" | "mid" | "senior" | "staff" | "unknown";
  domain: string;
  role_title: string;
}
```

Failure policy:
- Retry once with 2 s backoff.
- On second failure: **hard stop** — `"JD extraction failed — cannot proceed without job signals."` All downstream scoring depends on JD signals; continuing would produce meaningless output.
- If `must_haves` is empty (sparse JD): emit a `WARN` to stdout and switch to embedding-only
  scoring mode (see §5).

**Resume Extraction** — 1 OpenAI call per resume (`gpt-4o`, temperature 0, strict JSON schema output):

```typescript
interface ResumeSignals {
  skills: string[];
  titles: string[];
  years_of_experience: number | null;
  highlights: string[];   // max 3 bullet-length strings
}
```

Failure policy: retry once (1 s → 2 s backoff). On second failure, add to skipped list with
reason. Never halt the run for a single resume failure.

**Grounding check**: After extraction, for each skill verify it appears as a
case-insensitive substring in the raw resume text. Remove any skill that fails this check.
This reduces hallucination propagation into scores without an extra API call.

**Text truncation**: Before any OpenAI call, if text exceeds 6,000 tokens (≈ 24,000 chars),
keep the first 3,000 tokens + last 3,000 tokens with a separator:
`"[...middle section truncated...]"`. This preserves the objective/summary and the most
recent experience. Log a warning for every truncated file.

### 4.3 Embedding Layer

- Model: `text-embedding-3-large` (higher quality embeddings for matching).
- Input: raw parsed text (not the extracted JSON) — embeds full semantic meaning of the document.
- Similarity metric: cosine similarity.
- **Caching**: after computing, persist to `output/.embedding-cache.json` keyed by
  `sha256(rawText)`. On re-run, cache hits skip the API call entirely. If a cache entry is
  corrupted (fails JSON parse), log a warning, delete the entry, and recompute.

### 4.4 Concurrency

Resume extraction and embedding calls are dispatched with a capped concurrency pool
(`p-limit`, default = 3, configurable via `concurrency` in the request body).

```
JD extraction  →  [done]
                      │
              ┌───────┴────────┐
       Resume batch (p-limit=N)
       [ext+embed] [ext+embed] [ext+embed]  ...
              └───────┬────────┘
                   Score all
                      │
              Job Store updated → status: completed
```

This maps directly to the production model: N workers consuming an SQS queue. The
`concurrency` request field is the local proxy for worker count.

**In-Memory Job Store shape**:

```typescript
type JobStatus = "queued" | "running" | "completed" | "failed";

interface JobRecord {
  runId: string;
  status: JobStatus;
  createdAt: string;       // ISO 8601
  completedAt?: string;
  result?: RankedOutput;
  error?: string;
}
```

The store is a module-level `Map<string, JobRecord>`. For the POC this is sufficient;
in production this maps to a Redis hash or a `job_runs` DB table.

---

## 5. Scoring Formula

All sub-scores normalized to [0, 1] before weighting.

| Component | Weight (normal JD) | Weight (sparse JD — no must-haves) |
|---|---|---|
| Must-have overlap | 0.50 | 0.00 |
| Embedding cosine similarity | 0.35 | 1.00 |
| Nice-to-have overlap | 0.15 | 0.00 |

**Must-have overlap**:
```
overlap_score = matched_must_haves_count / total_must_haves_count
```

**Must-have penalty**: steeper-than-linear curve based on missing ratio, capped at −0.35:
```
must_have_penalty = max(-0.35 * (missing_must_haves / total_must_haves) ^ 1.35, -0.35)
```
This penalizes broad requirement gaps more aggressively while keeping a strict floor.

**Seniority penalty**: small deterministic penalty based on JD seniority level vs
`years_of_experience` (if available), max −0.08.

**Overlap matching**: fuzzy — skill A from JD matches skill B from resume if
`A.toLowerCase()` is a substring of `B.toLowerCase()` or vice versa. Matching checks
skills + titles + highlights + normalized raw resume text. Requirement counts once if
matched by any source (no double-counting). A small alias map (e.g., `k8s`↔`kubernetes`,
`postgres`↔`postgresql`) is applied before overlap checks.

**Final score**:
```
final = clamp(weighted_sum - penalties, 0, 1)
```
Rounded to 4 decimal places.

**Tie-breaking** (deterministic, reproducible):
1. Higher embedding cosine similarity.
2. Alphabetical by filename ascending.

---

## 6. Cold Start Reasoning

No historical hire data, feedback signals, or prior match patterns exist for a new job posting.
This system handles cold start structurally:

1. **Explicit signal extraction**: The LLM reads the JD and externalizes must-haves as discrete
   named requirements. No training data required — signals come from the JD itself.
2. **Semantic embeddings**: Embeddings capture semantic intent beyond keyword frequency.
   Candidates describing equivalent experience with different terminology still score well.
3. **Graceful degradation**: If the JD is sparse and must-haves cannot be extracted, the system
   automatically falls back to embedding-only scoring rather than producing undefined output.

**Known calibration gap**: The weights (50/35/15) are heuristic. Without historical feedback
we cannot know whether must-have overlap is actually the strongest predictor of hire quality
for a specific role. This is documented in `DESIGN.md` with a calibration improvement path
(collect recruiter feedback → tune weights → A/B test scoring variants).

---

## 7. Output Schema

**`output/ranked-<timestamp>.json`**:

```json
{
  "job_title": "Senior Backend Engineer",
  "jd_file": "job-description.pdf",
  "generated_at": "2026-04-13T10:00:00Z",
  "total_candidates_evaluated": 9,
  "total_valid_candidates": 8,
  "scoring_mode": "full",
  "top_candidates": [
    {
      "rank": 1,
      "file": "alice_resume.pdf",
      "final_score": 0.8712,
      "sub_scores": {
        "must_have_overlap": 0.9167,
        "embedding_similarity": 0.8341,
        "nice_to_have_overlap": 0.6000,
        "missing_must_have_penalty": -0.08
      },
      "matched_must_haves": ["Node.js", "PostgreSQL", "REST APIs"],
      "missing_must_haves": ["Kubernetes"],
      "matched_nice_to_haves": ["Redis", "GraphQL"],
      "reason": "Meets 3 of 4 must-haves (missing: Kubernetes). Strong semantic match (0.83). Covers 2 of 3 nice-to-haves."
    }
  ]
}
```

`scoring_mode` is `"full"` when must-haves are present, `"embedding_only"` for sparse JDs.

If fewer than 10 candidates are valid, `top_candidates` contains all valid candidates — not
padded. `total_valid_candidates` makes the count explicit.

**`output/skipped-<timestamp>.json`**:

```json
{
  "skipped": [
    { "file": "scan_resume.pdf", "reason": "PDF appears to be image-based (OCR not supported)" },
    { "file": "corrupt.docx",   "reason": "DOCX parse error: unexpected end of archive" }
  ]
}
```

---

## 8. Edge Case Handling

| Edge Case | Handling |
|---|---|
| N < 10 valid resumes | Output all valid candidates; `total_valid_candidates` reflects actual count |
| JD extraction fails after retry | Hard stop with clear error message; no partial output |
| JD `must_haves` is empty | Warn + switch to `embedding_only` scoring mode |
| Resume extraction fails after retry | Add to skipped list; continue run |
| Image-based / scan PDF | ParseResult `success: false`; logged in skipped output |
| Resume text < 200 chars | Warn + add to skipped list with reason |
| Resume text > 6,000 tokens | Truncate (first + last 3K tokens) + warn + continue |
| Duplicate resume (same SHA256) | Deduplicate before processing; log which filename was dropped |
| Tie on final score | Break by embedding similarity desc, then by filename alpha asc |
| `output/` directory missing | Create at startup before any processing |
| Output file collision | Always use timestamped filenames; no silent overwrite |
| OpenAI 429 rate limit | Exponential backoff: 1 s → 2 s → 4 s, max 3 attempts |
| OpenAI returns invalid JSON | Retry once; if still invalid, add to skipped |
| Embedding cache corrupted | Log warning, delete bad entry, recompute |
| `OPENAI_API_KEY` missing | Exit immediately with `"OPENAI_API_KEY not set in environment"` |

---

## 9. Error Handling Architecture

```typescript
class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

class ParseError extends AppError {}
class ExtractionError extends AppError {}
class EmbeddingError extends AppError {}
class ConfigError extends AppError {}
```

All OpenAI calls wrapped in a `withRetry(fn, maxAttempts, backoffMs)` utility.
All errors logged with the originating filename as context. No silent swallowing.

---

## 10. Project Structure

```
resume-parser/
  src/
    config/         # env vars, port, defaults, constants
    routes/         # rankingsRouter, healthRouter (Express routers only)
    middleware/     # errorHandler, requestLogger, validateBody (zod)
    jobs/           # JobStore (in-memory Map), JobRecord types
    parsers/        # PdfParser, DocxParser, ParserRegistry, types
    extraction/     # JdExtractor, ResumeExtractor, prompts/, types
    embeddings/     # EmbeddingService, cache
    scoring/        # ScoringEngine, formula constants, fuzzy match
    pipeline/       # orchestrates all stages, concurrency management
    output/         # OutputWriter, ranked/skipped schema types
    errors/         # AppError hierarchy
    utils/          # retry, truncate, hash, clamp
    server.ts       # Express app setup + listen
    app.ts          # Express app factory (testable without listen)
  inputs/           # JD + resumes (gitignored if containing real PII)
  output/           # gitignored
  PRD.md
  DESIGN.md
  README.md
  .env.example      # OPENAI_API_KEY=, PORT=3000
  .gitignore        # includes .env, output/, node_modules/
  tsconfig.json
  package.json
```

`app.ts` creates and configures the Express app without calling `.listen()` — this keeps it
importable in tests without binding to a port. `server.ts` imports `app` and calls
`.listen()`.

---

## 11. Security & Secrets

- `OPENAI_API_KEY` and `PORT` live in `.env`, loaded via `dotenv`.
- `.env` listed in `.gitignore`. `.env.example` with empty values is committed:
  ```
  OPENAI_API_KEY=
  PORT=3000
  ```
- Server startup exits immediately if `OPENAI_API_KEY` is not set.
- No key, token, credential, or PII is ever logged or included in API responses.

---

## 12. Acceptance Criteria

| Criterion | Pass Condition |
|---|---|
| Server starts | `node dist/server.js` binds to port without error |
| `POST /api/v1/rankings` | Returns `202` with `runId` within 200 ms |
| `GET /api/v1/rankings/:runId` | Returns `200` with status `completed` and full result after pipeline finishes |
| `GET /api/v1/health` | Returns `200 { "status": "ok" }` |
| Invalid request body | Returns `400` with structured error; pipeline not triggered |
| Unknown `runId` | Returns `404` |
| PDF parsing | All non-scan PDFs in sample set parsed to non-empty text |
| DOCX parsing | All DOCX in sample set parsed to non-empty text |
| Ranked output | `result.top_candidates` has ≥ 1 entry when valid resumes exist |
| Skipped log | `result.skipped` present (may be empty array) |
| Sub-scores present | Every ranked entry has all four sub-score fields |
| Reasons present | Every ranked entry has a non-empty, human-readable `reason` string |
| OpenAI used | Extraction + embeddings both use OpenAI (verifiable from server logs) |
| No secrets in repo | `git log` and file tree contain no API keys |
| DESIGN.md complete | Covers system design, data flow, production scaling, failure modes |
| AI log committed | Full prompt/chat history in repo |
| Reproducible | Evaluator can run server + curl commands from README |

---

## 13. Known Limitations (document in DESIGN.md)

- Must-have weights are heuristic; no calibration against historical hire data.
- Grounding check is substring-based; will miss paraphrased equivalents.
- Embeddings capture semantic similarity, not structured reasoning about role fit.
- Image-based PDFs are skipped entirely (no OCR).
- Non-English documents are not supported.
- LLM extraction quality depends on prompt; prompt versions are not separately versioned (acceptable for POC).
- Verbose resumes with many skills may score higher than concise resumes of equal quality.

---

## 14. DESIGN.md Required Sections

1. **System Overview** — what the POC does and its explicit boundaries.
2. **Data Flow Diagram** — intake → parse → extract → embed → score → output.
3. **Production Architecture** — S3 (file storage), SQS (job queue), ECS/Lambda workers,
   RDS/Aurora (results store), Redis (embedding cache), Pinecone/pgvector (ANN search).
4. **Scaling Considerations** — 50K candidates × 1.5K roles; pre-compute embeddings offline;
   incremental re-embed on profile update; approximate nearest-neighbour replaces brute-force
   cosine at scale.
5. **Cold Start** — same reasoning as §6, expanded with calibration improvement path.
6. **Known Failure Modes** — OpenAI outage, LLM hallucination, scan PDFs, token limit,
   embedding model drift, scoring bias toward verbose resumes, rate limit cascades.
7. **Deliberate Scope Cuts** — what was not built and why.

---

## 15. Time Budget (target: ≤ 3 hours)

| Task | Estimate |
|---|---|
| Project setup (tsconfig, ESLint, dotenv, folder structure) | 15 min |
| Express app + routes + middleware (zod validation, error handler) | 25 min |
| Job Store + async pipeline trigger | 15 min |
| Parser layer (PDF + DOCX + registry + types) | 20 min |
| JD + resume extraction (prompts, retry, grounding check) | 30 min |
| Embedding service + SHA256 cache | 20 min |
| Scoring engine (formula, penalties, tie-break) | 20 min |
| Pipeline orchestrator + concurrency (`p-limit`) | 15 min |
| Output writer | 10 min |
| Manual test via curl against sample inputs | 10 min |
| DESIGN.md | 20 min |
| README (curl examples) + `.env.example` + AI log commit | 10 min |
| **Total** | **~3 hours 10 min** |

> The HTTP layer adds ~25–30 min vs a pure CLI approach. Offset by removing the CLI
> argument parsing step. Budget is still within the assessment window.
