import { describe, it, expect } from 'vitest';
import { extractJSON, isValidExtractionResult, isValidValidationResult } from '../utils/json-repair';

describe('extractJSON', () => {
  it('parses clean JSON directly', () => {
    const raw = '{"detection": {"documentType": "COC"}, "summary": "test"}';
    const result = extractJSON(raw);
    expect(result).toEqual({ detection: { documentType: 'COC' }, summary: 'test' });
  });

  it('strips markdown code fences', () => {
    const raw = '```json\n{"detection": {"documentType": "COC"}, "summary": "test"}\n```';
    const result = extractJSON(raw);
    expect(result).toEqual({ detection: { documentType: 'COC' }, summary: 'test' });
  });

  it('strips triple backtick without language tag', () => {
    const raw = '```\n{"key": "value"}\n```';
    const result = extractJSON(raw);
    expect(result).toEqual({ key: 'value' });
  });

  it('extracts JSON from surrounding text', () => {
    const raw = 'Here is the result:\n\n{"detection": {"documentType": "PEME"}, "summary": "ok"}\n\nI hope this helps!';
    const result = extractJSON(raw);
    expect(result).toEqual({ detection: { documentType: 'PEME' }, summary: 'ok' });
  });

  it('handles nested braces in surrounding text', () => {
    const raw = 'The analysis is: {"data": {"nested": {"deep": true}}, "count": 3} done.';
    const result = extractJSON(raw);
    expect(result).toEqual({ data: { nested: { deep: true } }, count: 3 });
  });

  it('handles trailing commas', () => {
    const raw = '{"a": 1, "b": 2,}';
    const result = extractJSON(raw);
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('returns null for completely invalid input', () => {
    const raw = 'This is not JSON at all';
    const result = extractJSON(raw);
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const result = extractJSON('');
    expect(result).toBeNull();
  });

  it('handles JSON with line comments', () => {
    const raw = '{\n"a": 1, // this is a comment\n"b": 2\n}';
    const result = extractJSON(raw);
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('extracts JSON from markdown fences with preamble text', () => {
    const raw = 'Based on my analysis of the document:\n\n```json\n{"detection": {"documentType": "SIRB"}, "holder": {"fullName": "John"}, "fields": [], "validity": {}, "summary": "test"}\n```\n\nLet me know if you need more details.';
    const result = extractJSON(raw);
    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>).detection).toEqual({ documentType: 'SIRB' });
  });

  it('handles LLM response with explanation before JSON', () => {
    const raw = `I've analyzed the maritime document. Here are the results:

{
  "detection": {
    "documentType": "COC",
    "documentName": "Certificate of Competency",
    "category": "CERTIFICATION",
    "applicableRole": "DECK",
    "isRequired": true,
    "confidence": "HIGH",
    "detectionReason": "Title clearly states Certificate of Competency"
  },
  "holder": {
    "fullName": "John Smith",
    "dateOfBirth": null,
    "nationality": null,
    "passportNumber": null,
    "sirbNumber": null,
    "rank": null,
    "photo": "ABSENT"
  },
  "fields": [],
  "validity": {
    "dateOfIssue": null,
    "dateOfExpiry": null,
    "isExpired": false,
    "daysUntilExpiry": null,
    "revalidationRequired": null
  },
  "compliance": {
    "issuingAuthority": "MARINA",
    "regulationReference": null,
    "imoModelCourse": null,
    "recognizedAuthority": true,
    "limitations": null
  },
  "medicalData": {
    "fitnessResult": "N/A",
    "drugTestResult": "N/A",
    "restrictions": null,
    "specialNotes": null,
    "expiryDate": null
  },
  "flags": [],
  "summary": "Certificate of competency for John Smith issued by MARINA."
}`;
    const result = extractJSON(raw);
    expect(result).not.toBeNull();
    expect(isValidExtractionResult(result)).toBe(true);
  });
});

describe('isValidExtractionResult', () => {
  it('returns true for valid structure', () => {
    const obj = {
      detection: { documentType: 'COC' },
      holder: { fullName: 'John' },
      fields: [],
      validity: {},
      summary: 'test',
    };
    expect(isValidExtractionResult(obj)).toBe(true);
  });

  it('returns false for missing detection', () => {
    const obj = {
      holder: { fullName: 'John' },
      fields: [],
      validity: {},
      summary: 'test',
    };
    expect(isValidExtractionResult(obj)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isValidExtractionResult(null)).toBe(false);
  });

  it('returns false for string', () => {
    expect(isValidExtractionResult('string')).toBe(false);
  });
});

describe('isValidValidationResult', () => {
  it('returns true for valid structure', () => {
    const obj = {
      holderProfile: {},
      overallStatus: 'APPROVED',
      overallScore: 95,
      summary: 'test',
    };
    expect(isValidValidationResult(obj)).toBe(true);
  });

  it('returns false for missing fields', () => {
    const obj = {
      holderProfile: {},
      overallStatus: 'APPROVED',
    };
    expect(isValidValidationResult(obj)).toBe(false);
  });
});
