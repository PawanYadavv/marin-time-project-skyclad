import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from '../config';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = path.resolve(config.database.path);
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
  }
}

export function runMigrations(): void {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS extractions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      file_name TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      document_type TEXT,
      document_name TEXT,
      category TEXT,
      applicable_role TEXT,
      confidence TEXT,
      holder_name TEXT,
      date_of_birth TEXT,
      sirb_number TEXT,
      passport_number TEXT,
      fields_json TEXT,
      validity_json TEXT,
      compliance_json TEXT,
      medical_data_json TEXT,
      flags_json TEXT,
      is_expired INTEGER NOT NULL DEFAULT 0,
      summary TEXT,
      raw_llm_response TEXT,
      processing_time_ms INTEGER,
      status TEXT NOT NULL DEFAULT 'PENDING',
      error_code TEXT,
      error_message TEXT,
      prompt_version TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_extractions_session_id ON extractions(session_id);
    CREATE INDEX IF NOT EXISTS idx_extractions_file_hash ON extractions(file_hash);
    CREATE INDEX IF NOT EXISTS idx_extractions_document_type ON extractions(document_type);
    CREATE INDEX IF NOT EXISTS idx_extractions_status ON extractions(status);
    CREATE INDEX IF NOT EXISTS idx_extractions_is_expired ON extractions(is_expired);
    CREATE INDEX IF NOT EXISTS idx_extractions_session_hash ON extractions(session_id, file_hash);

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      extraction_id TEXT NOT NULL REFERENCES extractions(id),
      file_data BLOB,
      file_name TEXT,
      mime_type TEXT,
      status TEXT NOT NULL DEFAULT 'QUEUED',
      error_code TEXT,
      error_message TEXT,
      retryable INTEGER NOT NULL DEFAULT 0,
      queued_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_session_id ON jobs(session_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_extraction_id ON jobs(extraction_id);

    CREATE TABLE IF NOT EXISTS validations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_validations_session_id ON validations(session_id);
  `);
}
