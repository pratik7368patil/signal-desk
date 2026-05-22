import { randomUUID } from "node:crypto";
import type { AgentPrompt, DraftStatus, Priority, StoredDraft } from "../types.js";
import type { SignalDeskDb } from "./sqlite.js";

interface DraftRow {
  id: string;
  event_identity: string;
  channel: string;
  thread_ts: string;
  original_ts: string;
  original_user: string | null;
  priority: Priority;
  selected_repos_json: string;
  selected_agent: string;
  prompt_hash: string;
  prompt_json: string;
  draft: string;
  confidence: number;
  assumptions_json: string;
  sources_json: string;
  status: DraftStatus;
  dm_channel: string | null;
  dm_ts: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateDraftInput {
  eventIdentity: string;
  channel: string;
  threadTs: string;
  originalTs: string;
  originalUser?: string;
  priority: Priority;
  selectedRepos: string[];
  selectedAgent: string;
  promptHash: string;
  prompt: AgentPrompt;
  draft: string;
  confidence: number;
  assumptions: string[];
  sources: string[];
  status?: DraftStatus;
}

export class DraftsRepo {
  constructor(private readonly db: SignalDeskDb) {}

  createDraft(input: CreateDraftInput): StoredDraft {
    const id = randomUUID();
    const now = new Date().toISOString();
    const status = input.status ?? "pending";
    this.db
      .prepare(
        `INSERT INTO drafts (
          id, event_identity, channel, thread_ts, original_ts, original_user, priority,
          selected_repos_json, selected_agent, prompt_hash, prompt_json, draft, confidence,
          assumptions_json, sources_json, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.eventIdentity,
        input.channel,
        input.threadTs,
        input.originalTs,
        input.originalUser ?? null,
        input.priority,
        JSON.stringify(input.selectedRepos),
        input.selectedAgent,
        input.promptHash,
        JSON.stringify(input.prompt),
        input.draft,
        input.confidence,
        JSON.stringify(input.assumptions),
        JSON.stringify(input.sources),
        status,
        now,
        now
      );
    const draft = this.getDraft(id);
    if (!draft) {
      throw new Error("Failed to create draft");
    }
    return draft;
  }

  getDraft(id: string): StoredDraft | undefined {
    const row = this.db.prepare("SELECT * FROM drafts WHERE id = ?").get(id) as DraftRow | undefined;
    return row ? rowToDraft(row) : undefined;
  }

  getDraftByEventIdentity(eventIdentity: string): StoredDraft | undefined {
    const row = this.db.prepare("SELECT * FROM drafts WHERE event_identity = ?").get(eventIdentity) as DraftRow | undefined;
    return row ? rowToDraft(row) : undefined;
  }

  list(options: { limit?: number; status?: DraftStatus } = {}): StoredDraft[] {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
    const rows = options.status
      ? (this.db.prepare("SELECT * FROM drafts WHERE status = ? ORDER BY updated_at DESC LIMIT ?").all(options.status, limit) as unknown as DraftRow[])
      : (this.db.prepare("SELECT * FROM drafts ORDER BY updated_at DESC LIMIT ?").all(limit) as unknown as DraftRow[]);
    return rows.map(rowToDraft);
  }

  attachDm(id: string, dmChannel: string, dmTs: string): void {
    this.db
      .prepare("UPDATE drafts SET dm_channel = ?, dm_ts = ?, updated_at = ? WHERE id = ?")
      .run(dmChannel, dmTs, new Date().toISOString(), id);
  }

  updateStatus(id: string, status: DraftStatus): void {
    this.db
      .prepare("UPDATE drafts SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, new Date().toISOString(), id);
  }

  updateDraftContent(
    id: string,
    input: { draft: string; confidence?: number; assumptions?: string[]; sources?: string[]; status?: DraftStatus }
  ): void {
    const current = this.getDraft(id);
    if (!current) {
      throw new Error(`Draft not found: ${id}`);
    }
    this.db
      .prepare(
        `UPDATE drafts
         SET draft = ?, confidence = ?, assumptions_json = ?, sources_json = ?, status = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.draft,
        input.confidence ?? current.confidence,
        JSON.stringify(input.assumptions ?? current.assumptions),
        JSON.stringify(input.sources ?? current.sources),
        input.status ?? current.status,
        new Date().toISOString(),
        id
      );
  }

  countDraftsSince(sinceIso: string): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM drafts WHERE created_at >= ?").get(sinceIso) as
      | { count: number }
      | undefined;
    return row?.count ?? 0;
  }
}

function rowToDraft(row: DraftRow): StoredDraft {
  return {
    id: row.id,
    eventIdentity: row.event_identity,
    channel: row.channel,
    threadTs: row.thread_ts,
    originalTs: row.original_ts,
    ...(row.original_user === null ? {} : { originalUser: row.original_user }),
    priority: row.priority,
    selectedRepos: JSON.parse(row.selected_repos_json) as string[],
    selectedAgent: row.selected_agent,
    promptHash: row.prompt_hash,
    promptJson: row.prompt_json,
    draft: row.draft,
    confidence: row.confidence,
    assumptions: JSON.parse(row.assumptions_json) as string[],
    sources: JSON.parse(row.sources_json) as string[],
    status: row.status,
    ...(row.dm_channel === null ? {} : { dmChannel: row.dm_channel }),
    ...(row.dm_ts === null ? {} : { dmTs: row.dm_ts }),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
