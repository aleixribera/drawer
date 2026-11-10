import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * The one SQLite file. Items, topics, devices, push subscriptions, model usage, settings, and a full-text index
 * (FTS5) kept in step by the store. Migrations are numbered and run once each.
 */

const MIGRATIONS: string[] = [
  `
  CREATE TABLE topics (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    origin TEXT NOT NULL DEFAULT 'model',
    created_at TEXT NOT NULL
  );

  CREATE TABLE items (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    lane TEXT NOT NULL DEFAULT 'keep',
    text TEXT,
    url TEXT,
    dedupe_key TEXT,
    file_sha TEXT,
    file_name TEXT,
    file_mime TEXT,
    file_size INTEGER,
    label TEXT,
    title TEXT,
    summary TEXT,
    keywords TEXT,
    extracted TEXT,
    meta TEXT,
    topic_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
    topic_hint TEXT,
    sensitive INTEGER NOT NULL DEFAULT 0,
    sensitive_reasons TEXT,
    private_override INTEGER,
    pinned INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL,
    target TEXT,
    created_at TEXT NOT NULL,
    touched_at TEXT NOT NULL,
    opened_at TEXT,
    delivered_at TEXT,
    due_at TEXT,
    enrich_state TEXT NOT NULL DEFAULT 'pending',
    enrich_error TEXT,
    enriched_at TEXT,
    deleted_at TEXT
  );
  CREATE UNIQUE INDEX items_dedupe ON items(dedupe_key) WHERE dedupe_key IS NOT NULL AND lane = 'keep';
  CREATE INDEX items_touched ON items(touched_at DESC);
  CREATE INDEX items_topic ON items(topic_id, touched_at DESC);
  CREATE INDEX items_source ON items(source, created_at DESC);
  CREATE INDEX items_enrich ON items(enrich_state);

  CREATE VIRTUAL TABLE items_fts USING fts5(
    title, label, summary, keywords, body, extracted, file_name, host,
    tokenize = "unicode61 remove_diacritics 2"
  );

  CREATE TABLE devices (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_seen_at TEXT
  );

  CREATE TABLE push_subscriptions (
    id INTEGER PRIMARY KEY,
    device TEXT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    keys TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE usage (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    purpose TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL
  );
  CREATE INDEX usage_at ON usage(at);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // 2: items read only locally because the model was away (no key yet, or over the month's cap), to catch up later.
  `
  ALTER TABLE items ADD COLUMN waiting_for_model INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX items_waiting ON items(waiting_for_model) WHERE waiting_for_model = 1;
  `,
  // 3: things read only locally before migration 2 existed wait for the model too (catch-up still skips private ones).
  `
  UPDATE items SET waiting_for_model = 1
   WHERE enrich_state = 'local' AND lane = 'keep' AND deleted_at IS NULL
     AND sensitive = 0 AND (private_override IS NULL OR private_override = 0);
  `,
];

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  const version = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]!);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
