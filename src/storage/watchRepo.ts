import { randomUUID } from "node:crypto";
import type { WatchedThread, WatchedThreadStatus } from "../types.js";
import type { SignalDeskDb } from "./sqlite.js";

interface WatchRow {
  id: string;
  channel: string;
  thread_ts: string;
  permalink: string | null;
  reason: string;
  status: WatchedThreadStatus;
  last_seen_ts: string | null;
  created_at: string;
  updated_at: string;
}

export interface WatchThreadInput {
  channel: string;
  threadTs: string;
  permalink?: string;
  reason: string;
  lastSeenTs?: string;
}

export class WatchRepo {
  constructor(private readonly db: SignalDeskDb) {}

  watch(input: WatchThreadInput): WatchedThread {
    const existing = this.find(input.channel, input.threadTs);
    if (existing) {
      this.db
        .prepare(
          `UPDATE watched_threads
           SET permalink = COALESCE(?, permalink),
               reason = ?,
               status = 'active',
               last_seen_ts = COALESCE(?, last_seen_ts),
               updated_at = ?
           WHERE id = ?`
        )
        .run(input.permalink ?? null, input.reason, input.lastSeenTs ?? null, new Date().toISOString(), existing.id);
      return this.require(existing.id);
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO watched_threads (
          id, channel, thread_ts, permalink, reason, status, last_seen_ts, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`
      )
      .run(id, input.channel, input.threadTs, input.permalink ?? null, input.reason, input.lastSeenTs ?? null, now, now);
    return this.require(id);
  }

  get(id: string): WatchedThread | undefined {
    const row = this.db.prepare("SELECT * FROM watched_threads WHERE id = ?").get(id) as WatchRow | undefined;
    return row ? rowToWatchedThread(row) : undefined;
  }

  find(channel: string, threadTs: string): WatchedThread | undefined {
    const row = this.db
      .prepare("SELECT * FROM watched_threads WHERE channel = ? AND thread_ts = ?")
      .get(channel, threadTs) as WatchRow | undefined;
    return row ? rowToWatchedThread(row) : undefined;
  }

  findActive(channel: string, threadTs: string): WatchedThread | undefined {
    const row = this.db
      .prepare("SELECT * FROM watched_threads WHERE channel = ? AND thread_ts = ? AND status = 'active'")
      .get(channel, threadTs) as WatchRow | undefined;
    return row ? rowToWatchedThread(row) : undefined;
  }

  list(): WatchedThread[] {
    const rows = this.db.prepare("SELECT * FROM watched_threads ORDER BY updated_at DESC").all() as unknown as WatchRow[];
    return rows.map(rowToWatchedThread);
  }

  stop(id: string): void {
    this.db.prepare("UPDATE watched_threads SET status = 'stopped', updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  updateLastSeen(id: string, lastSeenTs: string): void {
    this.db
      .prepare("UPDATE watched_threads SET last_seen_ts = ?, updated_at = ? WHERE id = ?")
      .run(lastSeenTs, new Date().toISOString(), id);
  }

  private require(id: string): WatchedThread {
    const watched = this.get(id);
    if (!watched) {
      throw new Error(`Watched thread not found: ${id}`);
    }
    return watched;
  }
}

function rowToWatchedThread(row: WatchRow): WatchedThread {
  return {
    id: row.id,
    channel: row.channel,
    threadTs: row.thread_ts,
    ...(row.permalink === null ? {} : { permalink: row.permalink }),
    reason: row.reason,
    status: row.status,
    ...(row.last_seen_ts === null ? {} : { lastSeenTs: row.last_seen_ts }),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
