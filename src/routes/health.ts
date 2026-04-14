import { Router, Request, Response } from 'express';
import { getDb } from '../db/database';
import { getLLMProvider } from '../llm/factory';
import { config } from '../config';
import { JobQueue } from '../queue/job-queue';

export function createHealthRouter(jobQueue: JobQueue): Router {
  const router = Router();
  const startTime = Date.now();

  router.get('/', async (_req: Request, res: Response) => {
    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

    // Check database
    let dbStatus = 'OK';
    try {
      const db = getDb();
      db.prepare('SELECT 1').get();
    } catch {
      dbStatus = 'ERROR';
    }

    // Check LLM provider (cached, lightweight)
    let llmStatus = 'OK';
    try {
      const provider = getLLMProvider();
      // Don't actually call the LLM on every health check — just verify it's configured
      llmStatus = provider ? 'OK' : 'ERROR';
    } catch {
      llmStatus = 'ERROR';
    }

    // Check queue
    const queueStatus = jobQueue.isHealthy() ? 'OK' : 'ERROR';

    const overallStatus = dbStatus === 'OK' && llmStatus === 'OK' && queueStatus === 'OK'
      ? 'OK'
      : 'DEGRADED';

    res.status(overallStatus === 'OK' ? 200 : 503).json({
      status: overallStatus,
      version: config.version,
      uptime: uptimeSeconds,
      dependencies: {
        database: dbStatus,
        llmProvider: llmStatus,
        queue: queueStatus,
      },
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
