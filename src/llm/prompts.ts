export const EXTRACTION_PROMPT = `You are an expert maritime document analyst with deep knowledge of STCW, MARINA, IMO, and international seafarer certification standards.

A document has been provided. Perform the following in a single pass:
1. IDENTIFY the document type from the taxonomy below
2. DETERMINE if this belongs to a DECK officer, ENGINE officer, BOTH, or is role-agnostic (N/A)
3. EXTRACT all fields that are meaningful for this specific document type
4. FLAG any compliance issues, anomalies, or concerns

Document type taxonomy (use these exact codes):
COC | COP_BT | COP_PSCRB | COP_AFF | COP_MEFA | COP_MECA | COP_SSO | COP_SDSD |
ECDIS_GENERIC | ECDIS_TYPE | SIRB | PASSPORT | PEME | DRUG_TEST | YELLOW_FEVER |
ERM | MARPOL | SULPHUR_CAP | BALLAST_WATER | HATCH_COVER | BRM_SSBT |
TRAIN_TRAINER | HAZMAT | FLAG_STATE | OTHER

Return ONLY a valid JSON object. No markdown. No code fences. No preamble.

{
  "detection": {
    "documentType": "SHORT_CODE",
    "documentName": "Full human-readable document name",
    "category": "IDENTITY | CERTIFICATION | STCW_ENDORSEMENT | MEDICAL | TRAINING | FLAG_STATE | OTHER",
    "applicableRole": "DECK | ENGINE | BOTH | N/A",
    "isRequired": true,
    "confidence": "HIGH | MEDIUM | LOW",
    "detectionReason": "One sentence explaining how you identified this document"
  },
  "holder": {
    "fullName": "string or null",
    "dateOfBirth": "DD/MM/YYYY or null",
    "nationality": "string or null",
    "passportNumber": "string or null",
    "sirbNumber": "string or null",
    "rank": "string or null",
    "photo": "PRESENT | ABSENT"
  },
  "fields": [
    {
      "key": "snake_case_key",
      "label": "Human-readable label",
      "value": "extracted value as string",
      "importance": "CRITICAL | HIGH | MEDIUM | LOW",
      "status": "OK | EXPIRED | WARNING | MISSING | N/A"
    }
  ],
  "validity": {
    "dateOfIssue": "string or null",
    "dateOfExpiry": "string | 'No Expiry' | 'Lifetime' | null",
    "isExpired": false,
    "daysUntilExpiry": null,
    "revalidationRequired": null
  },
  "compliance": {
    "issuingAuthority": "string",
    "regulationReference": "e.g. STCW Reg VI/1 or null",
    "imoModelCourse": "e.g. IMO 1.22 or null",
    "recognizedAuthority": true,
    "limitations": "string or null"
  },
  "medicalData": {
    "fitnessResult": "FIT | UNFIT | N/A",
    "drugTestResult": "NEGATIVE | POSITIVE | N/A",
    "restrictions": "string or null",
    "specialNotes": "string or null",
    "expiryDate": "string or null"
  },
  "flags": [
    {
      "severity": "CRITICAL | HIGH | MEDIUM | LOW",
      "message": "Description of issue or concern"
    }
  ],
  "summary": "Two-sentence plain English summary of what this document confirms about the holder."
}`;

export function buildRetryPrompt(fileName: string, mimeType: string): string {
  return `${EXTRACTION_PROMPT}

Additional context for improved accuracy:
- File name: ${fileName}
- File type: ${mimeType}
Please pay extra attention to document details and provide HIGH confidence extraction.`;
}

export function buildRepairPrompt(rawResponse: string): string {
  return `The following text was supposed to be a valid JSON object matching a specific schema, but it contains errors or extra text. 
Extract and return ONLY the valid JSON object. Fix any JSON syntax errors. Do not add any explanation or markdown formatting.

Raw text:
${rawResponse}`;
}

export function buildValidationPrompt(extractions: Array<{
  documentType: string;
  documentName: string;
  applicableRole: string;
  holderName: string | null;
  dateOfBirth: string | null;
  sirbNumber: string | null;
  passportNumber: string | null;
  validity: string | null;
  compliance: string | null;
  medicalData: string | null;
  flags: string | null;
  fields: string | null;
  summary: string | null;
}>): string {
  const documentsBlock = extractions.map((e, i) => `
--- Document ${i + 1}: ${e.documentType} (${e.documentName}) ---
Role: ${e.applicableRole}
Holder: ${e.holderName || 'Unknown'}
DOB: ${e.dateOfBirth || 'Unknown'}
SIRB: ${e.sirbNumber || 'N/A'}
Passport: ${e.passportNumber || 'N/A'}
Validity: ${e.validity || 'N/A'}
Compliance: ${e.compliance || 'N/A'}
Medical: ${e.medicalData || 'N/A'}
Flags: ${e.flags || 'None'}
Fields: ${e.fields || 'N/A'}
Summary: ${e.summary || 'N/A'}
`).join('\n');

  return `You are a senior maritime compliance auditor reviewing a seafarer's document portfolio for pre-employment screening. You must assess cross-document consistency, completeness, and regulatory compliance.

Today's date is: ${new Date().toISOString().split('T')[0]}

The following documents have been submitted for a single seafarer:

${documentsBlock}

Perform the following analysis:

1. HOLDER PROFILE: Build a unified profile from all documents. Identify the most likely name, DOB, nationality, rank, and role (DECK or ENGINE).

2. CONSISTENCY CHECKS: Compare holder identity fields (name, DOB, SIRB number, passport number) across all documents. Flag any discrepancies. Each check should specify which documents were compared and whether they are CONSISTENT, INCONSISTENT, or MISSING.

3. MISSING DOCUMENTS: Based on the detected role (DECK or ENGINE) and STCW requirements, identify any required or recommended documents that are missing from this portfolio. Categories:
   - REQUIRED: COC, SIRB, Passport, PEME, Basic Safety Training (COP_BT), PSCRB (COP_PSCRB), AFF (COP_AFF)
   - RECOMMENDED for DECK: ECDIS, BRM/SSBT, MARPOL, ERM
   - RECOMMENDED for ENGINE: MEFA (COP_MEFA), MECA (COP_MECA)
   - OPTIONAL: Drug Test, Yellow Fever, Flag State endorsement

4. EXPIRING DOCUMENTS: List all documents with expiry dates. Calculate days until expiry from today. Classify urgency:
   - EXPIRED: already past expiry
   - CRITICAL: expires within 30 days
   - WARNING: expires within 90 days
   - OK: expires after 90 days

5. MEDICAL FLAGS: Review any medical/drug test results. Flag unfitness, positive drug tests, restrictions, or special conditions that affect employability.

6. OVERALL STATUS: Assign one of:
   - APPROVED: All required docs present, consistent, valid, no critical flags
   - CONDITIONAL: Minor issues (warnings, expiring docs, missing recommended docs)
   - REJECTED: Missing required docs, expired critical certs, failed medical, identity inconsistencies

7. OVERALL SCORE: A number 0-100 representing portfolio completeness and compliance. 90+ = strong, 70-89 = acceptable with conditions, below 70 = significant gaps.

8. SUMMARY: 2-3 sentence assessment suitable for a Manning Agent making a hire/no-hire decision.

9. RECOMMENDATIONS: Specific actionable steps to resolve any issues found.

Return ONLY a valid JSON object. No markdown. No code fences. No preamble.

{
  "holderProfile": {
    "name": "string or null",
    "dateOfBirth": "string or null",
    "nationality": "string or null",
    "rank": "string or null",
    "detectedRole": "DECK | ENGINE | UNKNOWN",
    "sirbNumber": "string or null",
    "passportNumber": "string or null"
  },
  "consistencyChecks": [
    {
      "field": "field name being compared",
      "status": "CONSISTENT | INCONSISTENT | MISSING",
      "details": "explanation",
      "documents": ["DOC_TYPE_1", "DOC_TYPE_2"]
    }
  ],
  "missingDocuments": [
    {
      "documentType": "SHORT_CODE",
      "documentName": "Full name",
      "importance": "REQUIRED | RECOMMENDED | OPTIONAL",
      "reason": "Why this document is needed"
    }
  ],
  "expiringDocuments": [
    {
      "documentType": "SHORT_CODE",
      "fileName": "original file name",
      "expiryDate": "date string",
      "daysUntilExpiry": 0,
      "urgency": "EXPIRED | CRITICAL | WARNING | OK"
    }
  ],
  "medicalFlags": [
    {
      "type": "FITNESS | DRUG_TEST | RESTRICTION | CONDITION",
      "status": "status value",
      "details": "explanation",
      "severity": "CRITICAL | HIGH | MEDIUM | LOW"
    }
  ],
  "overallStatus": "APPROVED | CONDITIONAL | REJECTED",
  "overallScore": 0,
  "summary": "Assessment summary",
  "recommendations": ["recommendation 1", "recommendation 2"]
}`;
}
