/**
 * In-process job queue backed by SQLite.
 *
 * Jobs are persisted to the jobs table, so they survive process restarts.
 * A polling loop picks up QUEUED jobs and processes them sequentially
 * with configurable concurrency.
 *
 * This is appropriate for a single-instance deployment. For horizontal
 * scaling, migrate to pg-boss or BullMQ. See ADR for discussion.
 */

import { getDb } from '../db/database';
import { JobStatus } from '../types';

type JobProcessor = (job: {
  jobId: string;
  extractionId: string;
  sessionId: string;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
}) => Promise<void>;

export class JobQueue {
  private processor: JobProcessor | null = null;
  private running = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private concurrency: number;
  private activeJobs = 0;

  constructor(concurrency: number = 2) {
    this.concurrency = concurrency;
  }

  /**
   * Register the function that processes jobs.
   */
  onProcess(processor: JobProcessor): void {
    this.processor = processor;
  }

  /**
   * Start polling for queued jobs.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    // Recover any jobs that were PROCESSING when the server crashed
    this.recoverOrphanedJobs();

    this.pollInterval = setInterval(() => this.poll(), 1000);
    this.pollInterval.unref();

    // Run immediately on start
    this.poll();
  }

  /**
   * Stop the queue gracefully.
   */
  stop(): void {
    this.running = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Get queue depth (number of QUEUED jobs).
   */
  getQueueDepth(): number {
    const db = getDb();
    const row = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'QUEUED'").get() as { count: number };
    return row.count;
  }

  /**
   * Get queue position for a specific job.
   */
  getQueuePosition(jobId: string): number {
    const db = getDb();
    const row = db.prepare(`
      SELECT COUNT(*) as position FROM jobs 
      WHERE status = 'QUEUED' AND queued_at <= (SELECT queued_at FROM jobs WHERE id = ?)
    `).get(jobId) as { position: number } | undefined;
    return row?.position ?? 0;
  }

  isHealthy(): boolean {
    return this.running;
  }

  private poll(): void {
    if (!this.running || !this.processor) return;
    if (this.activeJobs >= this.concurrency) return;

    const db = getDb();
    const jobs = db.prepare(`
      SELECT id, session_id, extraction_id, file_data, file_name, mime_type
      FROM jobs 
      WHERE status = 'QUEUED' 
      ORDER BY queued_at ASC 
      LIMIT ?
    `).all(this.concurrency - this.activeJobs) as Array<{
      id: string;
      session_id: string;
      extraction_id: string;
      file_data: Buffer;
      file_name: string;
      mime_type: string;
    }>;

    for (const job of jobs) {
      this.processJob(job);
    }
  }

  private async processJob(job: {
    id: string;
    session_id: string;
    extraction_id: string;
    file_data: Buffer;
    file_name: string;
    mime_type: string;
  }): Promise<void> {
    if (!this.processor) return;

    const db = getDb();
    this.activeJobs++;

    // Mark as PROCESSING
    db.prepare(`
      UPDATE jobs SET status = 'PROCESSING', started_at = datetime('now') WHERE id = ?
    `).run(job.id);

    try {
      await this.processor({
        jobId: job.id,
        extractionId: job.extraction_id,
        sessionId: job.session_id,
        fileBuffer: job.file_data,
        fileName: job.file_name,
        mimeType: job.mime_type,
      });

      // Mark complete — clear the file blob to reclaim space
      db.prepare(`
        UPDATE jobs SET status = 'COMPLETE', completed_at = datetime('now'), file_data = NULL WHERE id = ?
      `).run(job.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const errorCode = message === 'LLM_TIMEOUT' ? 'LLM_TIMEOUT' : 'INTERNAL_ERROR';
      const retryable = errorCode === 'LLM_TIMEOUT' ? 1 : 0;

      db.prepare(`
        UPDATE jobs 
        SET status = 'FAILED', error_code = ?, error_message = ?, retryable = ?,
            completed_at = datetime('now'), file_data = NULL
        WHERE id = ?
      `).run(errorCode, message, retryable, job.id);

      // Also update extraction record
      db.prepare(`
        UPDATE extractions SET status = 'FAILED', error_code = ?, error_message = ? WHERE id = ?
      `).run(errorCode, message, job.extraction_id);
    } finally {
      this.activeJobs--;
    }
  }

  /**
   * On startup, reset any PROCESSING jobs to QUEUED.
   * These were interrupted by a crash/restart.
   */
  private recoverOrphanedJobs(): void {
    const db = getDb();
    const result = db.prepare(`
      UPDATE jobs SET status = 'QUEUED', started_at = NULL WHERE status = 'PROCESSING'
    `).run();

    if (result.changes > 0) {
      console.log(`[Queue] Recovered ${result.changes} orphaned jobs back to QUEUED`);
    }
  }
}
