import { describe, it, expect } from 'vitest';
import { computeSHA256 } from '../utils/hash';

describe('computeSHA256', () => {
  it('returns consistent hash for same input', () => {
    const buffer = Buffer.from('hello world');
    const hash1 = computeSHA256(buffer);
    const hash2 = computeSHA256(buffer);
    expect(hash1).toBe(hash2);
  });

  it('returns different hash for different input', () => {
    const hash1 = computeSHA256(Buffer.from('hello'));
    const hash2 = computeSHA256(Buffer.from('world'));
    expect(hash1).not.toBe(hash2);
  });

  it('returns a 64-character hex string', () => {
    const hash = computeSHA256(Buffer.from('test'));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
