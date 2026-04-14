import express from 'express';
import cors from 'cors';
import { config } from './config';
import { runMigrations } from './db/database';
import { createExtractRouter } from './routes/extract';
import { createJobsRouter } from './routes/jobs';
import sessionsRouter from './routes/sessions';
import { createHealthRouter } from './routes/health';
import { JobQueue } from './queue/job-queue';
import { extractDocument, getExtractionById } from './services/extraction.service';

// Run migrations on startup
runMigrations();

const app = express();

app.use(cors());
app.use(express.json());

// Trust proxy for accurate IP in rate limiting
app.set('trust proxy', 1);

// Initialize job queue
const jobQueue = new JobQueue(2);

// Register job processor
jobQueue.onProcess(async (job) => {
  await extractDocument({
    extractionId: job.extractionId,
    sessionId: job.sessionId,
    fileBuffer: job.fileBuffer,
    fileName: job.fileName,
    mimeType: job.mimeType,
    fileHash: '', // Hash already computed at upload time
  });
});

// Start queue processing
jobQueue.start();

// Mount routes
app.use('/api/extract', createExtractRouter(jobQueue));
app.use('/api/jobs', createJobsRouter(jobQueue));
app.use('/api/sessions', sessionsRouter);
app.use('/api/health', createHealthRouter(jobQueue));

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
  });
});

const server = app.listen(config.port, () => {
  console.log(`[SMDE] Server running on port ${config.port}`);
  console.log(`[SMDE] LLM Provider: ${config.llm.provider} (${config.llm.model})`);
  console.log(`[SMDE] Database: ${config.database.path}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SMDE] Shutting down...');
  jobQueue.stop();
  server.close();
});

process.on('SIGINT', () => {
  console.log('[SMDE] Shutting down...');
  jobQueue.stop();
  server.close();
});

export { app };
