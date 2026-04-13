# Resume Parser POC

Thin HTTP API service that ranks resumes against a job description using OpenAI extraction and embeddings.

## Tech Stack

- Node.js 20.x
- TypeScript
- Express
- OpenAI SDK

## Setup

```bash
pnpm install
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env`.

## Run

```bash
pnpm dev
```

Build and run production mode:

```bash
pnpm build
pnpm start
```

## API

### Health

```bash
curl -s http://localhost:3000/api/v1/health
```

### Create ranking run

```bash
curl -s -X POST http://localhost:3000/api/v1/rankings \
  -H "Content-Type: application/json" \
  -d '{
    "jdPath":"./inputs/job-description.docx",
    "resumesDir":"./inputs/resumes/",
    "concurrency":3
  }'
```

### Poll run result

```bash
curl -s http://localhost:3000/api/v1/rankings/<runId>
```

## Output files

- `output/ranked-<timestamp>.json`
- `output/skipped-<timestamp>.json`
- `output/.embedding-cache.json`

## Tests

```bash
pnpm test
```

