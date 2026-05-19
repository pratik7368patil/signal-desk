import { basename } from "node:path";
import type { LocalDocsSourceConfig } from "../config/schema.js";
import { indexLocalDocsSource, type DocsIndexResult } from "../context/localDocsIndexer.js";
import { openDatabase } from "../storage/sqlite.js";
import { readMutableConfig, writeMutableConfig } from "./configOps.js";

export function addDocsSource(configPath: string, input: { path: string; id?: string; repoId?: string }): LocalDocsSourceConfig {
  const config = readMutableConfig(configPath);
  const id = input.id ?? sanitizeSourceId(basename(input.path));
  if (config.local_docs.some((source) => source.id === id)) {
    throw new Error(`Docs source ${id} already exists`);
  }
  const source: LocalDocsSourceConfig = {
    id,
    path: input.path,
    ...(input.repoId === undefined ? {} : { repo_id: input.repoId }),
    include: ["**/*.md", "**/*.mdx", "**/*.txt", "README*"],
    exclude: ["node_modules/**", "dist/**", "build/**", ".git/**", ".env*", "**/*.pem", "**/*secret*"]
  };
  writeMutableConfig(configPath, {
    ...config,
    local_docs: [...config.local_docs, source]
  });
  return source;
}

export async function indexDocs(configPath: string): Promise<DocsIndexResult[]> {
  const config = readMutableConfig(configPath);
  const db = openDatabase();
  try {
    const results: DocsIndexResult[] = [];
    for (const source of config.local_docs) {
      results.push(await indexLocalDocsSource(db, source));
    }
    return results;
  } finally {
    db.close();
  }
}

function sanitizeSourceId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
