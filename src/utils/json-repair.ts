/**
 * Robust JSON extraction from LLM responses.
 *
 * LLMs frequently wrap JSON in markdown code fences, add explanatory text
 * before/after, or produce slightly malformed JSON. This module handles
 * all of those cases before falling back to an LLM repair prompt.
 */

/**
 * Attempt to extract a valid JSON object from raw LLM output.
 * Strategy:
 * 1. Try direct parse
 * 2. Strip markdown code fences and try again
 * 3. Find outermost { } boundary and parse that substring
 * 4. Return null if all fail
 */
export function extractJSON<T = unknown>(raw: string): T | null {
  // Strategy 1: Direct parse
  try {
    return JSON.parse(raw) as T;
  } catch {
    // continue
  }

  // Strategy 2: Strip markdown fences
  const fenceStripped = raw
    .replace(/^```(?:json)?\s*\n?/gm, '')
    .replace(/\n?```\s*$/gm, '')
    .trim();

  try {
    return JSON.parse(fenceStripped) as T;
  } catch {
    // continue
  }

  // Strategy 3: Find outermost { } boundary
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const jsonCandidate = raw.substring(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(jsonCandidate) as T;
    } catch {
      // Strategy 3b: Try to fix common issues in the extracted substring
      const fixed = fixCommonJsonIssues(jsonCandidate);
      try {
        return JSON.parse(fixed) as T;
      } catch {
        // continue
      }
    }
  }

  return null;
}

/**
 * Fix common JSON issues LLMs produce:
 * - Trailing commas before } or ]
 * - Single quotes instead of double quotes (for keys/values)
 * - Unescaped newlines in string values
 */
function fixCommonJsonIssues(raw: string): string {
  let fixed = raw;

  // Remove trailing commas before } or ]
  fixed = fixed.replace(/,\s*([}\]])/g, '$1');

  // Replace JavaScript-style comments
  fixed = fixed.replace(/\/\/.*$/gm, '');

  return fixed;
}

/**
 * Validate that a parsed object has the expected extraction structure.
 */
export function isValidExtractionResult(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return (
    'detection' in o &&
    'holder' in o &&
    'fields' in o &&
    'validity' in o &&
    'summary' in o
  );
}

/**
 * Validate that a parsed object has the expected validation result structure.
 */
export function isValidValidationResult(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return (
    'holderProfile' in o &&
    'overallStatus' in o &&
    'overallScore' in o &&
    'summary' in o
  );
}
