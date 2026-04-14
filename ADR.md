# Architecture Decision Record — SMDE Backend

## Question 1 — Sync vs Async

**Decision:** Async should be the production default.

LLM inference for vision models takes 3–15 seconds depending on document complexity and provider. Holding an HTTP connection open that long is acceptable for low-traffic internal tools, but problematic at scale: it ties up a connection slot, makes the client vulnerable to network timeouts, and gives no visibility into processing state.

Sync mode exists for convenience (developer testing, single-file uploads) but production clients should use async with polling. The UX is better — the client can show a progress indicator, and retries are handled server-side.

**Threshold for forced async:** Force async when the file exceeds 2MB or when more than 5 concurrent LLM requests are in-flight. The current implementation leaves this as a client choice, but a production version would reroute sync to async with `303 See Other` under load.

## Question 2 — Queue Choice

**Decision:** SQLite-backed in-process queue with a polling loop.

The service runs as a single Node.js process against SQLite. Adding Redis or RabbitMQ would double deployment complexity for a problem that doesn't yet require it. Jobs are persisted in the `jobs` table, surviving process restarts — on startup, any jobs stuck in `PROCESSING` are reset to `QUEUED`.

**Migration path at 500 concurrent extractions/minute:** Move to BullMQ backed by Redis. BullMQ provides concurrency control, dead letter queues, priorities, and rate limiting. The database would also migrate from SQLite to PostgreSQL, where pg-boss (PostgreSQL-native queuing) becomes another viable option.

**Failure modes of current approach:**
1. Single-process — if Node dies, in-flight jobs are interrupted (mitigated by PROCESSING → QUEUED recovery)
2. No backpressure — unbounded queue growth possible
3. Polling adds up to 1 second latency between enqueue and pickup
4. No job priority — all jobs are FIFO

## Question 3 — LLM Provider Abstraction

**Decision:** Built a provider interface with swappable implementations.

The `LLMProvider` interface defines: `sendMessage` (text + image), `sendTextMessage` (text only), and `healthCheck`. Three implementations exist:
- `AnthropicProvider` — native `@anthropic-ai/sdk`
- `GeminiProvider` — `@google/generative-ai`
- `OpenAICompatibleProvider` — covers OpenAI, Groq, Mistral, and Ollama (all expose a compatible chat completions API)

A factory reads `LLM_PROVIDER` from environment and instantiates the right implementation. Swapping providers is a one-line `.env` change. This supports a realistic pattern: local dev with Ollama, staging with Gemini (free tier), production with Claude.

## Question 4 — Why SQLite

SQLite was chosen because the assignment targets a single-node deployment where simplicity matters. There's no external database process to manage, no connection pooling, and the database file lives alongside the app. WAL mode is enabled for concurrent reads.

**Risks at scale:** JSON columns cannot be efficiently indexed in SQLite. Schema evolution in JSON fields is invisible — new LLM output fields get stored silently without validation.

**What I would change:** Migrate to PostgreSQL with JSONB columns and GIN indexes, enabling queries like `WHERE fields_json @> '{"status": "EXPIRED"}'`. Add a `field_values` table for full-text search across extraction fields.

## Question 5 — What I Skipped

1. **Authentication.** The API is unauthenticated. A production system needs API key management and session ownership. Skipped as orthogonal to the extraction pipeline.

2. **File storage.** Documents are processed in-memory, not persisted. Production would store originals in S3/GCS with encryption for audit trails and re-extraction.

3. **Webhook delivery.** Not implemented. Would require HMAC signatures, exponential backoff, delivery logs, and dead letter handling — a significant subsystem I chose not to half-implement.

4. **Observability.** No structured logging or metrics. Production would use pino for logging and Prometheus for extraction latency, LLM error rates, and queue depth.
