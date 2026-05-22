import { randomUUID } from "node:crypto";
import type { AttentionCategory, AttentionItem, AttentionState, Priority } from "../types.js";
import type { SignalDeskDb } from "./sqlite.js";

interface AttentionRow {
  id: string;
  event_identity: string;
  draft_id: string | null;
  category: AttentionCategory;
  priority: Exclude<Priority, "ignore">;
  state: AttentionState;
  channel: string;
  thread_ts: string;
  original_ts: string;
  permalink: string | null;
  title: string;
  summary: string;
  reasons_json: string;
  metadata_json: string;
  snoozed_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertAttentionInput {
  eventIdentity: string;
  draftId?: string;
  category: AttentionCategory;
  priority: Exclude<Priority, "ignore">;
  state: AttentionState;
  channel: string;
  threadTs: string;
  originalTs: string;
  permalink?: string;
  title: string;
  summary: string;
  reasons: string[];
  metadata?: Record<string, unknown>;
  snoozedUntil?: string;
}

export class AttentionRepo {
  constructor(private readonly db: SignalDeskDb) {}

  upsertFromEvent(input: UpsertAttentionInput): AttentionItem {
    const existing = this.getByEventIdentity(input.eventIdentity);
    if (existing) {
      this.db
        .prepare(
          `UPDATE attention_items
           SET draft_id = COALESCE(?, draft_id),
               category = ?,
               priority = ?,
               state = ?,
               permalink = COALESCE(?, permalink),
               title = ?,
               summary = ?,
               reasons_json = ?,
               metadata_json = ?,
               snoozed_until = ?,
               updated_at = ?
           WHERE id = ?`
        )
        .run(
          input.draftId ?? null,
          input.category,
          input.priority,
          input.state,
          input.permalink ?? null,
          input.title,
          input.summary,
          JSON.stringify(input.reasons),
          JSON.stringify(input.metadata ?? existing.metadata),
          input.snoozedUntil ?? null,
          new Date().toISOString(),
          existing.id
        );
      return this.require(existing.id);
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO attention_items (
          id, event_identity, draft_id, category, priority, state, channel, thread_ts,
          original_ts, permalink, title, summary, reasons_json, metadata_json,
          snoozed_until, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.eventIdentity,
        input.draftId ?? null,
        input.category,
        input.priority,
        input.state,
        input.channel,
        input.threadTs,
        input.originalTs,
        input.permalink ?? null,
        input.title,
        input.summary,
        JSON.stringify(input.reasons),
        JSON.stringify(input.metadata ?? {}),
        input.snoozedUntil ?? null,
        now,
        now
      );
    return this.require(id);
  }

  get(id: string): AttentionItem | undefined {
    const row = this.db.prepare("SELECT * FROM attention_items WHERE id = ?").get(id) as AttentionRow | undefined;
    return row ? rowToAttentionItem(row) : undefined;
  }

  getByEventIdentity(eventIdentity: string): AttentionItem | undefined {
    const row = this.db.prepare("SELECT * FROM attention_items WHERE event_identity = ?").get(eventIdentity) as AttentionRow | undefined;
    return row ? rowToAttentionItem(row) : undefined;
  }

  list(options: { limit?: number; includeDismissed?: boolean } = {}): AttentionItem[] {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
    const rows = this.db
      .prepare(
        options.includeDismissed
          ? "SELECT * FROM attention_items ORDER BY updated_at DESC LIMIT ?"
          : "SELECT * FROM attention_items WHERE state NOT IN ('dismissed', 'posted') ORDER BY updated_at DESC LIMIT ?"
      )
      .all(limit) as unknown as AttentionRow[];
    return rows.map(rowToAttentionItem);
  }

  attachDraft(id: string, draftId: string): void {
    this.db
      .prepare("UPDATE attention_items SET draft_id = ?, state = 'drafted', updated_at = ? WHERE id = ?")
      .run(draftId, new Date().toISOString(), id);
  }

  updateStateByDraftId(draftId: string, state: AttentionState): void {
    this.db
      .prepare("UPDATE attention_items SET state = ?, updated_at = ? WHERE draft_id = ?")
      .run(state, new Date().toISOString(), draftId);
  }

  dismiss(id: string): void {
    this.db.prepare("UPDATE attention_items SET state = 'dismissed', updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  snooze(id: string, untilIso: string): void {
    this.db
      .prepare("UPDATE attention_items SET state = 'snoozed', snoozed_until = ?, updated_at = ? WHERE id = ?")
      .run(untilIso, new Date().toISOString(), id);
  }

  private require(id: string): AttentionItem {
    const item = this.get(id);
    if (!item) {
      throw new Error(`Attention item not found: ${id}`);
    }
    return item;
  }
}

function rowToAttentionItem(row: AttentionRow): AttentionItem {
  return {
    id: row.id,
    eventIdentity: row.event_identity,
    ...(row.draft_id === null ? {} : { draftId: row.draft_id }),
    category: row.category,
    priority: row.priority,
    state: row.state,
    channel: row.channel,
    threadTs: row.thread_ts,
    originalTs: row.original_ts,
    ...(row.permalink === null ? {} : { permalink: row.permalink }),
    title: row.title,
    summary: row.summary,
    reasons: JSON.parse(row.reasons_json) as string[],
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    ...(row.snoozed_until === null ? {} : { snoozedUntil: row.snoozed_until }),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
