# Smart Maritime Document Extractor (SMDE) — Backend API

Backend service that processes maritime seafarer documents (passports, COC, medical certificates, etc.) through a vision-capable LLM pipeline. It extracts structured JSON data from document images/PDFs, supports cross-document validation, and generates compliance reports — all behind a clean REST API.

## Setup

```bash
npm install
cp .env.example .env       # then add your LLM API key
npm run dev                 # starts server on http://localhost:3000
```

SQLite database is created automatically on first run — no extra migration step needed.

## Environment Variables

See `.env.example` for all options. The required ones:

| Variable | Description |
|----------|-------------|
| `LLM_PROVIDER` | `openai`, `gemini`, `anthropic`, `groq`, `mistral`, or `ollama` |
| `LLM_MODEL` | Model name (e.g. `gpt-4o-mini`, `gemini-2.0-flash`) |
| `LLM_API_KEY` | Your provider API key |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/extract` | Upload & extract a document (sync or async via `?mode=async`) |
| `GET` | `/api/jobs/:jobId` | Poll async job status |
| `GET` | `/api/sessions/:sessionId` | List all extractions in a session |
| `POST` | `/api/sessions/:sessionId/validate` | Cross-document validation (requires ≥2 docs) |
| `GET` | `/api/sessions/:sessionId/report` | Compliance report |
| `GET` | `/api/health` | Health check |

## Testing

```bash
npm test              # run unit tests (vitest)
npm run test:watch    # watch mode
```

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **Framework:** Express.js
- **Database:** SQLite (better-sqlite3)
- **LLM:** Swappable providers (OpenAI, Gemini, Anthropic, Groq, Mistral, Ollama)
- **Queue:** SQLite-backed in-process job queue
- **Tests:** Vitest

## Architecture

```
src/
├── server.ts              # Express app setup, route mounting
├── config.ts              # Environment configuration
├── types.ts               # TypeScript interfaces
├── db/
│   └── database.ts        # SQLite setup, migrations, schema
├── llm/
│   ├── provider.ts        # LLM provider interface
│   ├── factory.ts         # Provider factory (env-based)
│   ├── prompts.ts         # Extraction + validation prompts
│   └── providers/
│       ├── anthropic.ts   # Anthropic Claude implementation
│       ├── gemini.ts      # Google Gemini implementation
│       └── openai-compatible.ts  # OpenAI/Groq/Mistral/Ollama
├── services/
│   └── extraction.service.ts  # Core extraction logic
├── queue/
│   └── job-queue.ts       # SQLite-backed job queue
├── routes/
│   ├── extract.ts         # POST /api/extract
│   ├── jobs.ts            # GET /api/jobs/:jobId
│   ├── sessions.ts        # Session, validation, report routes
│   └── health.ts          # GET /api/health
├── utils/
│   ├── json-repair.ts     # LLM output JSON extraction
│   ├── hash.ts            # SHA-256 deduplication
│   └── rate-limiter.ts    # Token bucket rate limiter
└── tests/
    ├── json-repair.test.ts
    ├── rate-limiter.test.ts
    └── hash.test.ts
```

## Testing

```bash
npm test
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled production build |
| `npm test` | Run test suite |
| `npm run migrate` | Run database migrations manually |

## Key Design Decisions

See [ADR.md](ADR.md) for detailed architecture decisions covering:
- Sync vs async default mode
- Queue mechanism choice
- LLM provider abstraction
- Schema design tradeoffs
- What was deliberately skipped

## Code Review

See [CODE_REVIEW.md](CODE_REVIEW.md) for the review of the junior engineer's PR.
