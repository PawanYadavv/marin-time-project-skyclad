import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../utils/rate-limiter';

describe('RateLimiter', () => {
  it('allows requests within limit', () => {
    const limiter = new RateLimiter(3, 60000);

    expect(limiter.consume('ip1').allowed).toBe(true);
    expect(limiter.consume('ip1').allowed).toBe(true);
    expect(limiter.consume('ip1').allowed).toBe(true);
  });

  it('blocks requests over limit', () => {
    const limiter = new RateLimiter(2, 60000);

    expect(limiter.consume('ip1').allowed).toBe(true);
    expect(limiter.consume('ip1').allowed).toBe(true);

    const result = limiter.consume('ip1');
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it('tracks different IPs independently', () => {
    const limiter = new RateLimiter(1, 60000);

    expect(limiter.consume('ip1').allowed).toBe(true);
    expect(limiter.consume('ip2').allowed).toBe(true);

    const result = limiter.consume('ip1');
    expect(result.allowed).toBe(false);
  });
});
