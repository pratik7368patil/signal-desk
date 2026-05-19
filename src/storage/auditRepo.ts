import type { SignalDeskDb } from "./sqlite.js";

export class AuditRepo {
  constructor(private readonly db: SignalDeskDb) {}

  record(action: string, details: Record<string, unknown>, draftId?: string): void {
    this.db
      .prepare("INSERT INTO audit_logs (draft_id, action, details_json, created_at) VALUES (?, ?, ?, ?)")
      .run(draftId ?? null, action, JSON.stringify(details), new Date().toISOString());
  }

  list(): Array<{ id: number; draftId?: string; action: string; details: Record<string, unknown>; createdAt: string }> {
    const rows = this.db.prepare("SELECT * FROM audit_logs ORDER BY id ASC").all() as Array<{
      id: number;
      draft_id: string | null;
      action: string;
      details_json: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      ...(row.draft_id === null ? {} : { draftId: row.draft_id }),
      action: row.action,
      details: JSON.parse(row.details_json) as Record<string, unknown>,
      createdAt: row.created_at
    }));
  }
}
