import { randomUUID } from "node:crypto";
import type { SignalDeskDb } from "./sqlite.js";

export interface StyleHint {
  id: string;
  draftId?: string;
  hint: string;
  source: string;
  createdAt: string;
}

interface StyleHintRow {
  id: string;
  draft_id: string | null;
  hint: string;
  source: string;
  created_at: string;
}

export class StyleHintsRepo {
  constructor(private readonly db: SignalDeskDb) {}

  record(input: { draftId?: string; hint: string; source: string }): StyleHint {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare("INSERT INTO style_hints (id, draft_id, hint, source, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, input.draftId ?? null, input.hint, input.source, now);
    return {
      id,
      ...(input.draftId === undefined ? {} : { draftId: input.draftId }),
      hint: input.hint,
      source: input.source,
      createdAt: now
    };
  }

  list(limit = 50): StyleHint[] {
    const rows = this.db.prepare("SELECT * FROM style_hints ORDER BY created_at DESC LIMIT ?").all(limit) as unknown as StyleHintRow[];
    return rows.map((row) => ({
      id: row.id,
      ...(row.draft_id === null ? {} : { draftId: row.draft_id }),
      hint: row.hint,
      source: row.source,
      createdAt: row.created_at
    }));
  }
}
