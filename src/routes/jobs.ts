import { Router, Request, Response } from 'express';
import { getDb } from '../db/database';
import { formatExtractionResponse, getExtractionById } from '../services/extraction.service';
import { JobQueue } from '../queue/job-queue';

export function createJobsRouter(jobQueue: JobQueue): Router {
  const router = Router();

  router.get('/:jobId', (req: Request<{ jobId: string }>, res: Response) => {
    const jobId = req.params.jobId;
    const db = getDb();

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as Record<string, unknown> | undefined;

    if (!job) {
      res.status(404).json({
        error: 'JOB_NOT_FOUND',
        message: `Job ${jobId} does not exist.`,
      });
      return;
    }

    const status = job.status as string;

    if (status === 'QUEUED' || status === 'PROCESSING') {
      const queuePosition = status === 'QUEUED' ? jobQueue.getQueuePosition(jobId) : 0;

      res.status(200).json({
        jobId,
        status,
        queuePosition,
        startedAt: job.started_at || null,
        estimatedCompleteMs: status === 'PROCESSING' ? 3200 : queuePosition * 5000,
      });
      return;
    }

    if (status === 'COMPLETE') {
      const extraction = getExtractionById(job.extraction_id as string);

      res.status(200).json({
        jobId,
        status: 'COMPLETE',
        extractionId: job.extraction_id,
        result: extraction ? formatExtractionResponse(extraction) : null,
        completedAt: job.completed_at,
      });
      return;
    }

    if (status === 'FAILED') {
      res.status(200).json({
        jobId,
        status: 'FAILED',
        error: job.error_code || 'INTERNAL_ERROR',
        message: job.error_message || 'Unknown error',
        failedAt: job.completed_at,
        retryable: job.retryable === 1,
      });
      return;
    }

    res.status(200).json({ jobId, status });
  });

  // Bonus: Retry endpoint
  router.post('/:jobId/retry', (req: Request<{ jobId: string }>, res: Response) => {
    const jobId = req.params.jobId;
    const db = getDb();

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as Record<string, unknown> | undefined;

    if (!job) {
      res.status(404).json({
        error: 'JOB_NOT_FOUND',
        message: `Job ${jobId} does not exist.`,
      });
      return;
    }

    if (job.status !== 'FAILED') {
      res.status(400).json({
        error: 'INVALID_STATE',
        message: `Job ${jobId} is in ${job.status} state. Only FAILED jobs can be retried.`,
      });
      return;
    }

    // Reset extraction to PENDING
    db.prepare("UPDATE extractions SET status = 'PENDING', error_code = NULL, error_message = NULL WHERE id = ?")
      .run(job.extraction_id);

    // Re-queue the job
    db.prepare(`
      UPDATE jobs SET status = 'QUEUED', error_code = NULL, error_message = NULL,
        retryable = 0, started_at = NULL, completed_at = NULL, queued_at = datetime('now')
      WHERE id = ?
    `).run(jobId);

    res.status(202).json({
      jobId,
      status: 'QUEUED',
      pollUrl: `/api/jobs/${jobId}`,
      message: 'Job has been re-queued for processing.',
    });
  });

  return router;
}
