/**
 * In-memory sliding window rate limiter using token bucket algorithm.
 *
 * Chosen for simplicity — no external dependency needed. In production,
 * this would be replaced with a Redis-based counter for multi-instance
 * deployments. See ADR for discussion.
 */

interface RateLimitEntry {
  tokens: number;
  lastRefill: number;
}

export class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private maxTokens: number;
  private windowMs: number;

  constructor(maxTokens: number, windowMs: number) {
    this.maxTokens = maxTokens;
    this.windowMs = windowMs;

    // Clean up stale entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000).unref();
  }

  /**
   * Check and consume a token for the given key.
   * Returns { allowed: true } or { allowed: false, retryAfterMs }.
   */
  consume(key: string): { allowed: true } | { allowed: false; retryAfterMs: number } {
    const now = Date.now();
    let entry = this.store.get(key);

    if (!entry) {
      entry = { tokens: this.maxTokens, lastRefill: now };
      this.store.set(key, entry);
    }

    // Refill tokens based on elapsed time
    const elapsed = now - entry.lastRefill;
    const tokensToAdd = (elapsed / this.windowMs) * this.maxTokens;
    entry.tokens = Math.min(this.maxTokens, entry.tokens + tokensToAdd);
    entry.lastRefill = now;

    if (entry.tokens >= 1) {
      entry.tokens -= 1;
      return { allowed: true };
    }

    // Calculate when the next token will be available
    const retryAfterMs = Math.ceil(
      ((1 - entry.tokens) / this.maxTokens) * this.windowMs
    );

    return { allowed: false, retryAfterMs };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now - entry.lastRefill > this.windowMs * 2) {
        this.store.delete(key);
      }
    }
  }
}
