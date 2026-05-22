import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SlackMessageLike } from "../types.js";

export type SignalDeskDb = DatabaseSync;

export function openDatabase(pathValue = process.env.SIGNALD_DB_PATH ?? ".signald.sqlite"): SignalDeskDb {
  const resolved = pathValue === ":memory:" ? pathValue : resolve(pathValue);
  if (resolved !== ":memory:") {
    mkdirSync(dirname(resolved), { recursive: true });
  }
  const db = new DatabaseSync(resolved);
  initializeDatabase(db);
  return db;
}

export function initializeDatabase(db: SignalDeskDb): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      event_identity TEXT PRIMARY KEY,
      event_id TEXT,
      channel TEXT NOT NULL,
      ts TEXT NOT NULL,
      thread_ts TEXT,
      user_id TEXT,
      type TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY,
      event_identity TEXT NOT NULL,
      channel TEXT NOT NULL,
      thread_ts TEXT NOT NULL,
      original_ts TEXT NOT NULL,
      original_user TEXT,
      priority TEXT NOT NULL,
      selected_repos_json TEXT NOT NULL,
      selected_agent TEXT NOT NULL,
      prompt_hash TEXT NOT NULL,
      prompt_json TEXT NOT NULL,
      draft TEXT NOT NULL,
      confidence REAL NOT NULL,
      assumptions_json TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      status TEXT NOT NULL,
      dm_channel TEXT,
      dm_ts TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      draft_id TEXT,
      action TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (draft_id) REFERENCES drafts(id)
    );

    CREATE TABLE IF NOT EXISTS provider_metadata (
      id TEXT PRIMARY KEY,
      provider_type TEXT NOT NULL,
      status TEXT NOT NULL,
      details_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS slack_messages (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      ts TEXT NOT NULL,
      user_id TEXT,
      text TEXT NOT NULL,
      permalink TEXT,
      captured_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS slack_messages_fts USING fts5(
      text,
      channel UNINDEXED,
      user_id UNINDEXED,
      permalink UNINDEXED,
      content='slack_messages',
      content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS slack_messages_ai AFTER INSERT ON slack_messages BEGIN
      INSERT INTO slack_messages_fts(rowid, text, channel, user_id, permalink)
      VALUES (new.rowid, new.text, new.channel, new.user_id, new.permalink);
    END;

    CREATE TRIGGER IF NOT EXISTS slack_messages_ad AFTER DELETE ON slack_messages BEGIN
      INSERT INTO slack_messages_fts(slack_messages_fts, rowid, text, channel, user_id, permalink)
      VALUES('delete', old.rowid, old.text, old.channel, old.user_id, old.permalink);
    END;

    CREATE TRIGGER IF NOT EXISTS slack_messages_au AFTER UPDATE ON slack_messages BEGIN
      INSERT INTO slack_messages_fts(slack_messages_fts, rowid, text, channel, user_id, permalink)
      VALUES('delete', old.rowid, old.text, old.channel, old.user_id, old.permalink);
      INSERT INTO slack_messages_fts(rowid, text, channel, user_id, permalink)
      VALUES (new.rowid, new.text, new.channel, new.user_id, new.permalink);
    END;

    CREATE TABLE IF NOT EXISTS local_docs (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      repo_id TEXT,
      path TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      indexed_at TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS local_docs_fts USING fts5(
      title,
      content,
      path UNINDEXED,
      source_id UNINDEXED,
      repo_id UNINDEXED,
      content='local_docs',
      content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS local_docs_ai AFTER INSERT ON local_docs BEGIN
      INSERT INTO local_docs_fts(rowid, title, content, path, source_id, repo_id)
      VALUES (new.rowid, new.title, new.content, new.path, new.source_id, new.repo_id);
    END;

    CREATE TRIGGER IF NOT EXISTS local_docs_ad AFTER DELETE ON local_docs BEGIN
      INSERT INTO local_docs_fts(local_docs_fts, rowid, title, content, path, source_id, repo_id)
      VALUES('delete', old.rowid, old.title, old.content, old.path, old.source_id, old.repo_id);
    END;

    CREATE TRIGGER IF NOT EXISTS local_docs_au AFTER UPDATE ON local_docs BEGIN
      INSERT INTO local_docs_fts(local_docs_fts, rowid, title, content, path, source_id, repo_id)
      VALUES('delete', old.rowid, old.title, old.content, old.path, old.source_id, old.repo_id);
      INSERT INTO local_docs_fts(rowid, title, content, path, source_id, repo_id)
      VALUES (new.rowid, new.title, new.content, new.path, new.source_id, new.repo_id);
    END;

    CREATE TABLE IF NOT EXISTS attention_items (
      id TEXT PRIMARY KEY,
      event_identity TEXT NOT NULL UNIQUE,
      draft_id TEXT,
      category TEXT NOT NULL,
      priority TEXT NOT NULL,
      state TEXT NOT NULL,
      channel TEXT NOT NULL,
      thread_ts TEXT NOT NULL,
      original_ts TEXT NOT NULL,
      permalink TEXT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      reasons_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      snoozed_until TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS attention_items_state_idx ON attention_items(state, priority, updated_at);
    CREATE INDEX IF NOT EXISTS attention_items_channel_thread_idx ON attention_items(channel, thread_ts);

    CREATE TABLE IF NOT EXISTS watched_threads (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      thread_ts TEXT NOT NULL,
      permalink TEXT,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      last_seen_ts TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(channel, thread_ts)
    );

    CREATE INDEX IF NOT EXISTS watched_threads_status_idx ON watched_threads(status, channel, thread_ts);

    CREATE TABLE IF NOT EXISTS style_hints (
      id TEXT PRIMARY KEY,
      draft_id TEXT,
      hint TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES ('0001_initial', datetime('now'));
    INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES ('0002_productivity_beta', datetime('now'));
  `);
}

export function recordEventIfNew(
  db: SignalDeskDb,
  input: { eventIdentity: string; eventId?: string; event: SlackMessageLike }
): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO events (
        event_identity, event_id, channel, ts, thread_ts, user_id, type, raw_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.eventIdentity,
      input.eventId ?? null,
      input.event.channel,
      input.event.ts,
      input.event.thread_ts ?? null,
      input.event.user ?? null,
      input.event.type,
      JSON.stringify(input.event),
      new Date().toISOString()
    ) as { changes: number };
  return result.changes > 0;
}
