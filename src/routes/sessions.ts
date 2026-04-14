import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database';
import { getExtractionsBySessionId, formatExtractionResponse } from '../services/extraction.service';
import { getLLMProvider } from '../llm/factory';
import { buildValidationPrompt } from '../llm/prompts';
import { extractJSON, isValidValidationResult } from '../utils/json-repair';
import { buildRepairPrompt } from '../llm/prompts';
import { config } from '../config';
import type { OverallHealth, ValidationResult } from '../types';

const router = Router();

/**
 * GET /api/sessions/:sessionId
 */
router.get('/:sessionId', (req: Request<{ sessionId: string }>, res: Response) => {
  const sessionId = req.params.sessionId;
  const db = getDb();

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as Record<string, unknown> | undefined;
  if (!session) {
    res.status(404).json({
      error: 'SESSION_NOT_FOUND',
      message: `Session ${sessionId} does not exist.`,
    });
    return;
  }

  const extractions = getExtractionsBySessionId(sessionId);

  // Determine overall health
  let overallHealth: OverallHealth = 'OK';
  const now = new Date();

  for (const ext of extractions) {
    if (ext.status !== 'COMPLETE') continue;

    const flags = ext.flagsJson ? JSON.parse(ext.flagsJson) : [];
    const hasCriticalFlag = flags.some((f: { severity: string }) => f.severity === 'CRITICAL');

    if (hasCriticalFlag || ext.isExpired) {
      overallHealth = 'CRITICAL';
      break;
    }

    const hasMediumHighFlag = flags.some((f: { severity: string }) =>
      f.severity === 'MEDIUM' || f.severity === 'HIGH'
    );

    if (hasMediumHighFlag) {
      overallHealth = 'WARN';
    }

    // Check for certs expiring within 90 days
    if (ext.validityJson) {
      const validity = JSON.parse(ext.validityJson);
      if (validity.daysUntilExpiry !== null && validity.daysUntilExpiry <= 90) {
        overallHealth = overallHealth === 'CRITICAL' ? 'CRITICAL' : 'WARN';
      }
    }
  }

  // Detect role from extractions
  const roles = extractions
    .filter(e => e.status === 'COMPLETE' && e.applicableRole)
    .map(e => e.applicableRole);
  const detectedRole = roles.includes('ENGINE') && !roles.includes('DECK')
    ? 'ENGINE'
    : roles.includes('DECK') && !roles.includes('ENGINE')
      ? 'DECK'
      : roles.includes('DECK') && roles.includes('ENGINE')
        ? 'BOTH'
        : 'UNKNOWN';

  // Pending jobs
  const pendingJobs = db.prepare(
    "SELECT id, status FROM jobs WHERE session_id = ? AND status IN ('QUEUED', 'PROCESSING')"
  ).all(sessionId);

  const documents = extractions
    .filter(e => e.status === 'COMPLETE')
    .map(ext => {
      const flags = ext.flagsJson ? JSON.parse(ext.flagsJson) : [];
      return {
        id: ext.id,
        fileName: ext.fileName,
        documentType: ext.documentType,
        applicableRole: ext.applicableRole,
        holderName: ext.holderName,
        confidence: ext.confidence,
        isExpired: ext.isExpired,
        flagCount: flags.length,
        criticalFlagCount: flags.filter((f: { severity: string }) => f.severity === 'CRITICAL').length,
        createdAt: ext.createdAt,
      };
    });

  res.status(200).json({
    sessionId,
    documentCount: documents.length,
    detectedRole,
    overallHealth,
    documents,
    pendingJobs,
  });
});

/**
 * POST /api/sessions/:sessionId/validate
 */
router.post('/:sessionId/validate', async (req: Request<{ sessionId: string }>, res: Response) => {
  const sessionId = req.params.sessionId;
  const db = getDb();

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) {
    res.status(404).json({
      error: 'SESSION_NOT_FOUND',
      message: `Session ${sessionId} does not exist.`,
    });
    return;
  }

  const extractions = getExtractionsBySessionId(sessionId)
    .filter(e => e.status === 'COMPLETE');

  if (extractions.length < 2) {
    res.status(400).json({
      error: 'INSUFFICIENT_DOCUMENTS',
      message: 'Cross-document validation requires at least 2 completed extraction records.',
    });
    return;
  }

  try {
    const provider = getLLMProvider();

    const extractionData = extractions.map(e => ({
      documentType: e.documentType || 'UNKNOWN',
      documentName: e.documentName || e.fileName,
      applicableRole: e.applicableRole || 'N/A',
      holderName: e.holderName,
      dateOfBirth: e.dateOfBirth,
      sirbNumber: e.sirbNumber,
      passportNumber: e.passportNumber,
      validity: e.validityJson,
      compliance: e.complianceJson,
      medicalData: e.medicalDataJson,
      flags: e.flagsJson,
      fields: e.fieldsJson,
      summary: e.summary,
    }));

    const prompt = buildValidationPrompt(extractionData);
    const response = await provider.sendTextMessage(prompt, {
      timeoutMs: config.llm.timeoutMs,
    });

    let parsed = extractJSON<ValidationResult>(response.text);

    // Repair if needed
    if (!parsed || !isValidValidationResult(parsed)) {
      const repairResponse = await provider.sendTextMessage(
        buildRepairPrompt(response.text),
        { timeoutMs: config.llm.timeoutMs }
      );
      parsed = extractJSON<ValidationResult>(repairResponse.text);
    }

    if (!parsed || !isValidValidationResult(parsed)) {
      res.status(422).json({
        error: 'LLM_JSON_PARSE_FAIL',
        message: 'Validation analysis failed after retry.',
        retryAfterMs: null,
      });
      return;
    }

    // Add sessionId and timestamp
    parsed.sessionId = sessionId;
    parsed.validatedAt = new Date().toISOString();

    // Store validation result
    const validationId = uuidv4();
    db.prepare(`
      INSERT INTO validations (id, session_id, result_json)
      VALUES (?, ?, ?)
    `).run(validationId, sessionId, JSON.stringify(parsed));

    res.status(200).json(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message === 'LLM_TIMEOUT') {
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Validation request timed out.',
      });
      return;
    }

    console.error('[Validate] Error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred during validation.',
    });
  }
});

/**
 * GET /api/sessions/:sessionId/report
 */
router.get('/:sessionId/report', (req: Request<{ sessionId: string }>, res: Response) => {
  const sessionId = req.params.sessionId;
  const db = getDb();

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) {
    res.status(404).json({
      error: 'SESSION_NOT_FOUND',
      message: `Session ${sessionId} does not exist.`,
    });
    return;
  }

  const extractions = getExtractionsBySessionId(sessionId)
    .filter(e => e.status === 'COMPLETE');

  // Get most recent validation
  const validation = db.prepare(
    'SELECT * FROM validations WHERE session_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(sessionId) as Record<string, unknown> | undefined;

  const validationResult = validation
    ? JSON.parse(validation.result_json as string) as ValidationResult
    : null;

  // Build compliance report from data already in DB
  const documentSummaries = extractions.map(ext => {
    const flags = ext.flagsJson ? JSON.parse(ext.flagsJson) : [];
    const validity = ext.validityJson ? JSON.parse(ext.validityJson) : null;
    const medicalData = ext.medicalDataJson ? JSON.parse(ext.medicalDataJson) : null;

    return {
      id: ext.id,
      fileName: ext.fileName,
      documentType: ext.documentType,
      documentName: ext.documentName,
      category: ext.category,
      applicableRole: ext.applicableRole,
      confidence: ext.confidence,
      holderName: ext.holderName,
      isExpired: ext.isExpired,
      validity: validity ? {
        dateOfIssue: validity.dateOfIssue,
        dateOfExpiry: validity.dateOfExpiry,
        isExpired: validity.isExpired,
        daysUntilExpiry: validity.daysUntilExpiry,
      } : null,
      medicalSummary: medicalData ? {
        fitnessResult: medicalData.fitnessResult,
        drugTestResult: medicalData.drugTestResult,
        restrictions: medicalData.restrictions,
      } : null,
      flags: flags.map((f: { severity: string; message: string }) => ({
        severity: f.severity,
        message: f.message,
      })),
      summary: ext.summary,
    };
  });

  // Derive expiring documents from extraction data
  const expiringDocuments = extractions
    .filter(ext => {
      if (!ext.validityJson) return false;
      const validity = JSON.parse(ext.validityJson);
      return validity.daysUntilExpiry !== null && validity.daysUntilExpiry <= 90;
    })
    .map(ext => {
      const validity = JSON.parse(ext.validityJson!);
      return {
        documentType: ext.documentType,
        fileName: ext.fileName,
        expiryDate: validity.dateOfExpiry,
        daysUntilExpiry: validity.daysUntilExpiry,
        urgency: validity.isExpired
          ? 'EXPIRED'
          : validity.daysUntilExpiry <= 30
            ? 'CRITICAL'
            : 'WARNING',
      };
    })
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

  // Count critical issues
  const expiredCount = extractions.filter(e => e.isExpired).length;
  const criticalFlags = extractions.reduce((count, ext) => {
    const flags = ext.flagsJson ? JSON.parse(ext.flagsJson) : [];
    return count + flags.filter((f: { severity: string }) => f.severity === 'CRITICAL').length;
  }, 0);

  // Determine roles
  const roles = extractions.map(e => e.applicableRole).filter(Boolean);
  const detectedRole = roles.includes('ENGINE') && !roles.includes('DECK')
    ? 'ENGINE'
    : roles.includes('DECK') && !roles.includes('ENGINE')
      ? 'DECK'
      : 'BOTH';

  // Build the report
  const report = {
    reportId: `RPT-${sessionId.substring(0, 8)}`,
    sessionId,
    generatedAt: new Date().toISOString(),

    seafarerProfile: {
      name: extractions.find(e => e.holderName)?.holderName || 'Unknown',
      dateOfBirth: extractions.find(e => e.dateOfBirth)?.dateOfBirth || null,
      detectedRole,
      sirbNumber: extractions.find(e => e.sirbNumber)?.sirbNumber || null,
      passportNumber: extractions.find(e => e.passportNumber)?.passportNumber || null,
    },

    portfolioOverview: {
      totalDocuments: extractions.length,
      expiredDocuments: expiredCount,
      expiringIn90Days: expiringDocuments.length,
      criticalFlags,
      averageConfidence: extractions.reduce((sum, e) => {
        const scores: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
        return sum + (scores[e.confidence || ''] || 0);
      }, 0) / (extractions.length || 1),
    },

    documents: documentSummaries,
    expiringDocuments,

    complianceAssessment: validationResult ? {
      overallStatus: validationResult.overallStatus,
      overallScore: validationResult.overallScore,
      summary: validationResult.summary,
      consistencyChecks: validationResult.consistencyChecks,
      missingDocuments: validationResult.missingDocuments,
      medicalFlags: validationResult.medicalFlags,
      recommendations: validationResult.recommendations,
      lastValidatedAt: validationResult.validatedAt,
    } : null,

    decision: {
      recommendation: validationResult
        ? validationResult.overallStatus === 'APPROVED'
          ? 'PROCEED_WITH_HIRE'
          : validationResult.overallStatus === 'CONDITIONAL'
            ? 'PROCEED_WITH_CONDITIONS'
            : 'DO_NOT_PROCEED'
        : 'VALIDATION_REQUIRED',
      conditions: validationResult?.recommendations || [],
      note: !validationResult
        ? 'Cross-document validation has not been performed. Run POST /api/sessions/:sessionId/validate before generating a final report.'
        : null,
    },
  };

  res.status(200).json(report);
});

/**
 * Bonus: GET /api/sessions/:sessionId/expiring
 */
router.get('/:sessionId/expiring', (req: Request<{ sessionId: string }>, res: Response) => {
  const sessionId = req.params.sessionId;
  const withinDays = parseInt(req.query.withinDays as string) || 90;
  const db = getDb();

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) {
    res.status(404).json({
      error: 'SESSION_NOT_FOUND',
      message: `Session ${sessionId} does not exist.`,
    });
    return;
  }

  // Query using the validity_json field — extract daysUntilExpiry via JSON
  const rows = db.prepare(`
    SELECT id, file_name, document_type, document_name, validity_json, is_expired
    FROM extractions
    WHERE session_id = ?
      AND status = 'COMPLETE'
      AND validity_json IS NOT NULL
      AND (
        is_expired = 1
        OR json_extract(validity_json, '$.daysUntilExpiry') IS NOT NULL
          AND json_extract(validity_json, '$.daysUntilExpiry') <= ?
      )
    ORDER BY
      is_expired DESC,
      json_extract(validity_json, '$.daysUntilExpiry') ASC
  `).all(sessionId, withinDays) as Array<Record<string, unknown>>;

  const documents = rows.map(row => {
    const validity = JSON.parse(row.validity_json as string);
    return {
      id: row.id,
      fileName: row.file_name,
      documentType: row.document_type,
      documentName: row.document_name,
      expiryDate: validity.dateOfExpiry,
      daysUntilExpiry: validity.daysUntilExpiry,
      isExpired: row.is_expired === 1,
      urgency: row.is_expired === 1
        ? 'EXPIRED'
        : validity.daysUntilExpiry <= 30
          ? 'CRITICAL'
          : validity.daysUntilExpiry <= 90
            ? 'WARNING'
            : 'OK',
    };
  });

  res.status(200).json({
    sessionId,
    withinDays,
    count: documents.length,
    documents,
  });
});

export default router;
