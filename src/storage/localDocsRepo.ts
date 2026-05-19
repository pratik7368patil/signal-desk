import { createHash } from "node:crypto";
import type { SignalDeskDb } from "./sqlite.js";

export interface LocalDocRecord {
  id: string;
  sourceId: string;
  repoId?: string;
  path: string;
  title?: string;
  content: string;
  contentHash: string;
  indexedAt: string;
}

export interface LocalDocSearchResult {
  id: string;
  sourceId: string;
  repoId?: string;
  path: string;
  title?: string;
  snippet: string;
  score: number;
}

export class LocalDocsRepo {
  constructor(private readonly db: SignalDeskDb) {}

  upsert(input: Omit<LocalDocRecord, "id" | "contentHash" | "indexedAt">): LocalDocRecord {
    const contentHash = hashContent(input.content);
    const id = `${input.sourceId}:${hashContent(input.path)}`;
    const indexedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO local_docs (id, source_id, repo_id, path, title, content, content_hash, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           repo_id = excluded.repo_id,
           path = excluded.path,
           title = excluded.title,
           content = excluded.content,
           content_hash = excluded.content_hash,
           indexed_at = excluded.indexed_at`
      )
      .run(id, input.sourceId, input.repoId ?? null, input.path, input.title ?? null, input.content, contentHash, indexedAt);
    return { id, contentHash, indexedAt, ...input };
  }

  search(query: string, limit = 8): LocalDocSearchResult[] {
    const safeQuery = toFtsQuery(query);
    if (!safeQuery) {
      return [];
    }
    const rows = this.db
      .prepare(
        `SELECT local_docs.id, local_docs.source_id, local_docs.repo_id, local_docs.path, local_docs.title,
                snippet(local_docs_fts, 1, '[', ']', ' ... ', 20) AS snippet,
                bm25(local_docs_fts) AS score
         FROM local_docs_fts
         JOIN local_docs ON local_docs.rowid = local_docs_fts.rowid
         WHERE local_docs_fts MATCH ?
         ORDER BY score ASC
         LIMIT ?`
      )
      .all(safeQuery, limit) as Array<{
      id: string;
      source_id: string;
      repo_id: string | null;
      path: string;
      title: string | null;
      snippet: string;
      score: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      sourceId: row.source_id,
      ...(row.repo_id === null ? {} : { repoId: row.repo_id }),
      path: row.path,
      ...(row.title === null ? {} : { title: row.title }),
      snippet: row.snippet,
      score: row.score
    }));
  }

  listSources(): Array<{ sourceId: string; count: number; lastIndexedAt?: string }> {
    const rows = this.db
      .prepare("SELECT source_id, COUNT(*) as count, MAX(indexed_at) as last_indexed_at FROM local_docs GROUP BY source_id ORDER BY source_id")
      .all() as Array<{ source_id: string; count: number; last_indexed_at: string | null }>;
    return rows.map((row) => ({
      sourceId: row.source_id,
      count: row.count,
      ...(row.last_indexed_at === null ? {} : { lastIndexedAt: row.last_indexed_at })
    }));
  }
}

function hashContent(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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
