import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { config } from '../config';
import { computeSHA256 } from '../utils/hash';
import { RateLimiter } from '../utils/rate-limiter';
import {
  extractDocument,
  findDuplicate,
  createPendingExtraction,
  formatExtractionResponse,
} from '../services/extraction.service';
import { getDb } from '../db/database';
import { JobQueue } from '../queue/job-queue';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.upload.maxFileSizeBytes },
  fileFilter: (_req, file, cb) => {
    const allowed = config.upload.allowedMimeTypes as readonly string[];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('UNSUPPORTED_FORMAT'));
    }
  },
});

const rateLimiter = new RateLimiter(config.rateLimit.max, config.rateLimit.windowMs);

export function createExtractRouter(jobQueue: JobQueue): Router {
  router.post('/', (req: Request, res: Response) => {
    // Rate limiting
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const rateResult = rateLimiter.consume(clientIp);

    if (!rateResult.allowed) {
      const retryAfterSeconds = Math.ceil(rateResult.retryAfterMs / 1000);
      res.set('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: 'RATE_LIMITED',
        message: `Rate limit exceeded. Try again in ${retryAfterSeconds} seconds.`,
        retryAfterMs: rateResult.retryAfterMs,
      });
      return;
    }

    upload.single('document')(req, res, async (err) => {
      if (err) {
        if (err.message === 'UNSUPPORTED_FORMAT') {
          res.status(400).json({
            error: 'UNSUPPORTED_FORMAT',
            message: 'File type not accepted. Accepted types: JPEG, PNG, PDF.',
          });
          return;
        }
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({
            error: 'FILE_TOO_LARGE',
            message: `File exceeds maximum size of ${config.upload.maxFileSizeMB}MB.`,
          });
          return;
        }
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Upload failed.' });
        return;
      }

      if (!req.file) {
        res.status(400).json({
          error: 'UNSUPPORTED_FORMAT',
          message: 'No document file provided.',
        });
        return;
      }

      try {
        const file = req.file;
        const mode = (req.query.mode as string) || 'sync';
        const sessionId = (req.body.sessionId as string) || uuidv4();
        const fileHash = computeSHA256(file.buffer);

        // Ensure session exists
        const db = getDb();
        db.prepare('INSERT OR IGNORE INTO sessions (id) VALUES (?)').run(sessionId);

        // Deduplication check
        const existing = findDuplicate(sessionId, fileHash);
        if (existing) {
          res.set('X-Deduplicated', 'true');
          res.status(200).json(formatExtractionResponse(existing));
          return;
        }

        // Create pending extraction record
        const extractionId = createPendingExtraction(
          sessionId,
          file.originalname,
          fileHash,
          file.mimetype
        );

        if (mode === 'async') {
          // Async mode — enqueue job and return immediately
          const jobId = uuidv4();

          db.prepare(`
            INSERT INTO jobs (id, session_id, extraction_id, file_data, file_name, mime_type, status)
            VALUES (?, ?, ?, ?, ?, ?, 'QUEUED')
          `).run(jobId, sessionId, extractionId, file.buffer, file.originalname, file.mimetype);

          res.status(202).json({
            jobId,
            sessionId,
            status: 'QUEUED',
            pollUrl: `/api/jobs/${jobId}`,
            estimatedWaitMs: 6000,
          });
          return;
        }

        // Sync mode — process immediately
        const result = await extractDocument({
          extractionId,
          sessionId,
          fileBuffer: file.buffer,
          fileName: file.originalname,
          mimeType: file.mimetype,
          fileHash,
        });

        res.status(200).json(formatExtractionResponse(result));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';

        if (message === 'LLM_TIMEOUT') {
          res.status(500).json({
            error: 'INTERNAL_ERROR',
            message: 'LLM request timed out. Please try async mode.',
          });
          return;
        }

        if (message === 'LLM_JSON_PARSE_FAIL') {
          res.status(422).json({
            error: 'LLM_JSON_PARSE_FAIL',
            message: 'Document extraction failed after retry. The raw response has been stored for review.',
            retryAfterMs: null,
          });
          return;
        }

        console.error('[Extract] Error:', error);
        res.status(500).json({
          error: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred.',
        });
      }
    });
  });

  return router;
}
