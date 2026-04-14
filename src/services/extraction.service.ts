import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database';
import { getLLMProvider } from '../llm/factory';
import { EXTRACTION_PROMPT, buildRetryPrompt, buildRepairPrompt } from '../llm/prompts';
import { extractJSON, isValidExtractionResult } from '../utils/json-repair';
import { ensureImageBuffer } from '../utils/pdf-convert';
import { config } from '../config';
import type { LLMExtractionResult, ExtractionRecord } from '../types';

interface ExtractDocumentOptions {
  extractionId: string;
  sessionId: string;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  fileHash: string;
}

/**
 * Core extraction logic — takes a document buffer and runs it through
 * the LLM pipeline with full reliability handling.
 */
export async function extractDocument(options: ExtractDocumentOptions): Promise<ExtractionRecord> {
  const { extractionId, sessionId, fileBuffer, fileName, mimeType, fileHash } = options;
  const db = getDb();
  const provider = getLLMProvider();
  const startTime = Date.now();

  // Convert PDF to image if the provider doesn't support PDFs natively
  const converted = await ensureImageBuffer(fileBuffer, mimeType);
  const base64Data = converted.buffer.toString('base64');
  const effectiveMimeType = converted.mimeType;

  let rawResponse = '';
  let parsed: LLMExtractionResult | null = null;
  let confidence: string | null = null;

  try {
    // First attempt
    const response = await provider.sendMessage(EXTRACTION_PROMPT, {
      imageBase64: base64Data,
      imageMimeType: effectiveMimeType,
      timeoutMs: config.llm.timeoutMs,
    });

    rawResponse = response.text;
    parsed = extractJSON<LLMExtractionResult>(rawResponse);

    // If JSON extraction failed, try LLM repair
    if (!parsed || !isValidExtractionResult(parsed)) {
      const repairResponse = await provider.sendTextMessage(
        buildRepairPrompt(rawResponse),
        { timeoutMs: config.llm.timeoutMs }
      );
      rawResponse = rawResponse + '\n---REPAIR---\n' + repairResponse.text;
      parsed = extractJSON<LLMExtractionResult>(repairResponse.text);
    }

    // If still no valid result, throw parse error
    if (!parsed || !isValidExtractionResult(parsed)) {
      throw new Error('LLM_JSON_PARSE_FAIL');
    }

    confidence = parsed.detection?.confidence;

    // LOW confidence retry — retry once with hints
    if (confidence === 'LOW') {
      const retryResponse = await provider.sendMessage(
        buildRetryPrompt(fileName, mimeType),
        {
          imageBase64: base64Data,
          imageMimeType: effectiveMimeType,
          timeoutMs: config.llm.timeoutMs,
        }
      );

      const retryRaw = retryResponse.text;
      const retryParsed = extractJSON<LLMExtractionResult>(retryRaw);

      if (retryParsed && isValidExtractionResult(retryParsed)) {
        const retryConfidence = retryParsed.detection?.confidence;
        // Use retry result if confidence improved
        if (retryConfidence === 'HIGH' || retryConfidence === 'MEDIUM') {
          parsed = retryParsed;
          rawResponse = rawResponse + '\n---RETRY---\n' + retryRaw;
          confidence = retryConfidence;
        }
      }
    }

    const processingTimeMs = Date.now() - startTime;

    // Update extraction record with results
    db.prepare(`
      UPDATE extractions SET
        document_type = ?,
        document_name = ?,
        category = ?,
        applicable_role = ?,
        confidence = ?,
        holder_name = ?,
        date_of_birth = ?,
        sirb_number = ?,
        passport_number = ?,
        fields_json = ?,
        validity_json = ?,
        compliance_json = ?,
        medical_data_json = ?,
        flags_json = ?,
        is_expired = ?,
        summary = ?,
        raw_llm_response = ?,
        processing_time_ms = ?,
        status = 'COMPLETE',
        prompt_version = ?
      WHERE id = ?
    `).run(
      parsed.detection.documentType,
      parsed.detection.documentName,
      parsed.detection.category,
      parsed.detection.applicableRole,
      confidence,
      parsed.holder.fullName,
      parsed.holder.dateOfBirth,
      parsed.holder.sirbNumber,
      parsed.holder.passportNumber,
      JSON.stringify(parsed.fields),
      JSON.stringify(parsed.validity),
      JSON.stringify(parsed.compliance),
      JSON.stringify(parsed.medicalData),
      JSON.stringify(parsed.flags),
      parsed.validity.isExpired ? 1 : 0,
      parsed.summary,
      rawResponse,
      processingTimeMs,
      config.promptVersion,
      extractionId,
    );

    return getExtractionById(extractionId)!;
  } catch (error) {
    const processingTimeMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorCode = errorMessage === 'LLM_TIMEOUT' ? 'LLM_TIMEOUT' : 'LLM_JSON_PARSE_FAIL';

    // Never discard — store failure record with raw response
    db.prepare(`
      UPDATE extractions SET
        raw_llm_response = ?,
        processing_time_ms = ?,
        status = 'FAILED',
        error_code = ?,
        error_message = ?,
        prompt_version = ?
      WHERE id = ?
    `).run(
      rawResponse || null,
      processingTimeMs,
      errorCode,
      errorMessage,
      config.promptVersion,
      extractionId,
    );

    throw error;
  }
}

export function getExtractionById(id: string): ExtractionRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM extractions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapRowToExtraction(row);
}

export function getExtractionsBySessionId(sessionId: string): ExtractionRecord[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM extractions WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as Record<string, unknown>[];
  return rows.map(mapRowToExtraction);
}

export function findDuplicate(sessionId: string, fileHash: string): ExtractionRecord | null {
  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM extractions WHERE session_id = ? AND file_hash = ? AND status = 'COMPLETE'"
  ).get(sessionId, fileHash) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapRowToExtraction(row);
}

export function createPendingExtraction(
  sessionId: string,
  fileName: string,
  fileHash: string,
  mimeType: string
): string {
  const db = getDb();
  const id = uuidv4();

  // Ensure session exists
  db.prepare('INSERT OR IGNORE INTO sessions (id) VALUES (?)').run(sessionId);

  db.prepare(`
    INSERT INTO extractions (id, session_id, file_name, file_hash, mime_type, status)
    VALUES (?, ?, ?, ?, ?, 'PENDING')
  `).run(id, sessionId, fileName, fileHash, mimeType);

  return id;
}

function mapRowToExtraction(row: Record<string, unknown>): ExtractionRecord {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    fileName: row.file_name as string,
    fileHash: row.file_hash as string,
    mimeType: row.mime_type as string,
    documentType: row.document_type as string | null,
    documentName: row.document_name as string | null,
    category: row.category as string | null,
    applicableRole: row.applicable_role as string | null,
    confidence: row.confidence as string | null,
    holderName: row.holder_name as string | null,
    dateOfBirth: row.date_of_birth as string | null,
    sirbNumber: row.sirb_number as string | null,
    passportNumber: row.passport_number as string | null,
    fieldsJson: row.fields_json as string | null,
    validityJson: row.validity_json as string | null,
    complianceJson: row.compliance_json as string | null,
    medicalDataJson: row.medical_data_json as string | null,
    flagsJson: row.flags_json as string | null,
    isExpired: row.is_expired === 1,
    summary: row.summary as string | null,
    rawLlmResponse: row.raw_llm_response as string | null,
    processingTimeMs: row.processing_time_ms as number | null,
    status: row.status as 'PENDING' | 'COMPLETE' | 'FAILED',
    errorCode: row.error_code as string | null,
    errorMessage: row.error_message as string | null,
    promptVersion: row.prompt_version as string | null,
    createdAt: row.created_at as string,
  };
}

/**
 * Format an extraction record for API response.
 */
export function formatExtractionResponse(record: ExtractionRecord): Record<string, unknown> {
  const fields = record.fieldsJson ? JSON.parse(record.fieldsJson) : [];
  const validity = record.validityJson ? JSON.parse(record.validityJson) : null;
  const compliance = record.complianceJson ? JSON.parse(record.complianceJson) : null;
  const medicalData = record.medicalDataJson ? JSON.parse(record.medicalDataJson) : null;
  const flags = record.flagsJson ? JSON.parse(record.flagsJson) : [];

  return {
    id: record.id,
    sessionId: record.sessionId,
    fileName: record.fileName,
    documentType: record.documentType,
    documentName: record.documentName,
    category: record.category,
    applicableRole: record.applicableRole,
    confidence: record.confidence,
    holderName: record.holderName,
    dateOfBirth: record.dateOfBirth,
    sirbNumber: record.sirbNumber,
    passportNumber: record.passportNumber,
    fields,
    validity,
    compliance,
    medicalData,
    flags,
    isExpired: record.isExpired,
    processingTimeMs: record.processingTimeMs,
    summary: record.summary,
    promptVersion: record.promptVersion,
    status: record.status,
    createdAt: record.createdAt,
  };
}
