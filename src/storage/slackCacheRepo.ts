import type { SlackContext } from "../types.js";
import type { SignalDeskDb } from "./sqlite.js";

export interface SlackCacheSearchResult {
  id: string;
  channel: string;
  ts: string;
  userId?: string;
  snippet: string;
  permalink?: string;
  score: number;
}

export class SlackCacheRepo {
  constructor(private readonly db: SignalDeskDb) {}

  upsertContext(context: SlackContext, ttlHours: number): void {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60_000).toISOString();
    for (const message of context.messages) {
      const channel = message.channel ?? context.channel;
      const id = `${channel}:${message.ts}`;
      this.db
        .prepare(
          `INSERT INTO slack_messages (id, channel, ts, user_id, text, permalink, captured_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             user_id = excluded.user_id,
             text = excluded.text,
             permalink = excluded.permalink,
             captured_at = excluded.captured_at,
             expires_at = excluded.expires_at`
        )
        .run(id, channel, message.ts, message.user ?? null, message.text, context.permalink ?? null, now.toISOString(), expiresAt);
    }
    this.purgeExpired();
  }

  search(query: string, limit = 8): SlackCacheSearchResult[] {
    const safeQuery = toFtsQuery(query);
    if (!safeQuery) {
      return [];
    }
    const rows = this.db
      .prepare(
        `SELECT slack_messages.id, slack_messages.channel, slack_messages.ts, slack_messages.user_id,
                snippet(slack_messages_fts, 0, '[', ']', ' ... ', 20) AS snippet,
                slack_messages.permalink,
                bm25(slack_messages_fts) AS score
         FROM slack_messages_fts
         JOIN slack_messages ON slack_messages.rowid = slack_messages_fts.rowid
         WHERE slack_messages_fts MATCH ?
           AND slack_messages.expires_at > ?
         ORDER BY score ASC
         LIMIT ?`
      )
      .all(safeQuery, new Date().toISOString(), limit) as Array<{
      id: string;
      channel: string;
      ts: string;
      user_id: string | null;
      snippet: string;
      permalink: string | null;
      score: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      channel: row.channel,
      ts: row.ts,
      ...(row.user_id === null ? {} : { userId: row.user_id }),
      snippet: row.snippet,
      ...(row.permalink === null ? {} : { permalink: row.permalink }),
      score: row.score
    }));
  }

  purgeExpired(): void {
    this.db.prepare("DELETE FROM slack_messages WHERE expires_at <= ?").run(new Date().toISOString());
  }
}

function toFtsQuery(query: string): string {
  return query
    .split(/\s+/)
    .map((part) => part.replace(/[^a-zA-Z0-9_./-]/g, ""))
    .filter((part) => part.length >= 2)
    .slice(0, 12)
    .map((part) => `"${part}"`)
    .join(" OR ");
}
