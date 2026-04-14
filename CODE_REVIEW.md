# Code Review — feat: add document extraction endpoint

**PR by:** Junior Engineer
**Reviewer:** Senior Backend Engineer

---

## Overall Assessment

This is a solid first pass at the extraction endpoint — you got the core flow right (read file → base64 → send to LLM → parse response → return). That's the happy path, and it works. But there are several issues that would prevent this from being merged as-is, ranging from a **critical security issue** to architectural decisions that will create problems as the codebase grows. I've broken these out below.

None of this means the work is bad. It means the work is at "prototype" stage and needs to be hardened before it can serve real users. Let's walk through it.

---

## Critical — Must Fix Before Merge

### 1. Hardcoded API key (Line 8)

```ts
const client = new Anthropic({ apiKey: 'sk-ant-REDACTED' });
```

This is the highest-priority issue. API keys must **never** appear in source code, even in a development branch. If this were pushed to a public repo (or even a private one with multiple contributors), the key would be exposed. Anthropic actively scans GitHub for leaked keys and will revoke it.

**Fix:** Load the key from environment variables:
```ts
const client = new Anthropic({ apiKey: process.env.LLM_API_KEY });
```

Add the key to `.env` (which should be in `.gitignore`) and provide a `.env.example` template in the repo.

**Teaching moment:** Credential leaks are one of the most common security incidents in software. The rule is absolute: secrets go in environment variables or a secrets manager, never in code. Even for "quick testing," because quick testing code has a way of getting committed. Set up your `.env` workflow once and it protects you forever.

---

### 2. Using `claude-opus-4-6` — cost and performance (Line 12)

```ts
model: 'claude-opus-4-6',
```

Opus is Anthropic's most capable model, but it's also the most expensive — roughly 15x the cost of Haiku per token. For document extraction with a well-structured prompt, Haiku or Sonnet will produce equivalent results at a fraction of the cost. At scale (hundreds of documents per day), this would cost thousands of dollars monthly when it should cost tens.

**Fix:** Use `claude-haiku-4-5-20251001` or make the model configurable via environment variable. You'd be surprised how well smaller models perform with a precise prompt.

---

### 3. Global state for storage (Line 49)

```ts
global.extractions = global.extractions || [];
global.extractions.push(result);
```

This stores extraction results in a global array, which means:
- All data is lost on every server restart
- Memory usage grows unbounded (it never shrinks)
- There's no way to query, filter, or index the data
- In a multi-worker deployment, each worker has its own copy

**Fix:** Use a database. Even SQLite is a massive improvement — it persists to disk, supports queries, and handles concurrent reads. The suggested schema in the project spec is a good starting point.

---

## High Priority — Should Fix

### 4. No error handling for LLM response parsing (Line 47)

```ts
const result = JSON.parse(response.content[0].text);
```

This will throw if:
- The LLM wraps the JSON in markdown code fences (common)
- The LLM adds explanatory text before or after the JSON (very common)
- The response content array is empty (possible on API errors)
- `content[0]` is not a text block (possible with Anthropic's multi-block responses)

LLMs are unreliable output formatters. You should **always** assume the response might not be valid JSON and build extraction logic: strip code fences, find the outermost `{}`, and try to parse. If that fails, send the raw response back to the LLM with a repair prompt.

---

### 5. No timeout on the LLM call (Line 27–46)

The `client.messages.create()` call has no timeout. If Claude is slow or the API hangs, this request will hang indefinitely, tying up a connection slot and leaving the user waiting forever.

**Fix:** Set a 30-second timeout. On timeout, return a failure response to the user — don't just let it hang.

---

### 6. The prompt is too vague (Line 43)

```ts
text: 'Extract all information from this maritime document and return as JSON.',
```

This prompt gives the LLM almost no guidance about:
- What document types to look for
- What fields to extract
- What format the JSON should follow
- Whether to flag compliance issues

The result will be different every time the same document is uploaded. Consistent, structured output requires a structured prompt with a JSON schema, field taxonomy, and explicit instructions. The project spec provides exactly this prompt — use it.

---

### 7. Synchronous file operations (Lines 19–23)

```ts
const fileData = fs.readFileSync(file.path);
const savedPath = path.join('./uploads', file.originalname);
fs.copyFileSync(file.path, savedPath);
```

`readFileSync` and `copyFileSync` block the event loop. While these operations are running, the entire server cannot handle any other requests. For small files this is barely noticeable, but for a 10MB PDF it can block for hundreds of milliseconds.

**Fix:** Use `fs.promises.readFile` and `fs.promises.copyFile` (async versions). Or, since you're using multer, configure it with `memoryStorage()` to keep the file in a Buffer — no disk I/O needed for the extraction flow.

---

### 8. Saving uploaded files with original filenames (Line 22)

```ts
const savedPath = path.join('./uploads', file.originalname);
```

Two problems:
- **Path traversal risk**: `file.originalname` comes from the client. A malicious filename like `../../etc/passwd` could write outside the uploads directory. Always sanitize or use a generated filename (like a UUID).
- **PII on disk**: Maritime documents contain personal information (names, passport numbers, medical results). Saving them to the filesystem with no access controls, encryption, or retention policy creates a compliance liability. If these files are needed, store them in an encrypted object store with access audit logs.

---

## Lower Priority — Good to Fix

### 9. Error logging is insufficient (Line 53)

```ts
console.log('Error:', error);
```

`console.log` for errors loses the stack trace context. Use `console.error` at minimum, or better yet, a structured logger like `pino` that includes timestamps, request IDs, and error stack traces. When debugging production issues, you'll need this context.

### 10. Generic error response (Line 54)

```ts
res.status(500).json({ error: 'Something went wrong' });
```

This tells the client (and the developer debugging) nothing useful. At minimum, differentiate between: upload failures, LLM API errors, JSON parse failures, and unexpected exceptions. The project spec defines an error shape with specific error codes — adopt it.

---

## What's Good

- The core flow (upload → base64 → LLM → response) is correct and shows you understand the end-to-end pipeline
- Using multer for file handling is the right choice
- The route structure is clean and follows Express conventions
- Your PR description explains what the code does — keep doing that

---

## Summary

The PR needs work in three areas before it can be merged:

1. **Security** — remove the hardcoded API key immediately
2. **Reliability** — add JSON parse robustness, timeouts, and a database instead of global state
3. **Production readiness** — structured prompt, async file ops, proper error handling

I'd recommend: fix the API key issue in a hotfix commit today, then we can pair on the JSON extraction robustness and database integration — those are important patterns you'll use in every endpoint going forward.

Good work getting the prototype functional. Let's iterate on it.
