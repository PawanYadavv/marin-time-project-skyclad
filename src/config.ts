import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  llm: {
    provider: requireEnv('LLM_PROVIDER') as 'anthropic' | 'gemini' | 'groq' | 'openai' | 'mistral' | 'ollama',
    model: requireEnv('LLM_MODEL'),
    apiKey: process.env.LLM_API_KEY || '',
    timeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || '30000', 10),
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  },

  database: {
    path: process.env.DATABASE_PATH || './data/smde.db',
  },

  rateLimit: {
    max: parseInt(process.env.RATE_LIMIT_MAX || '10', 10),
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  },

  upload: {
    maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB || '10', 10),
    get maxFileSizeBytes() {
      return this.maxFileSizeMB * 1024 * 1024;
    },
    uploadDir: path.resolve(process.env.UPLOAD_DIR || './uploads'),
    allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'] as const,
  },

  version: '1.0.0',
  promptVersion: '1.0',
} as const;
