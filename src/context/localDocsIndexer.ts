import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { LocalDocsSourceConfig } from "../config/schema.js";
import { LocalDocsRepo } from "../storage/localDocsRepo.js";
import type { SignalDeskDb } from "../storage/sqlite.js";

export interface DocsIndexResult {
  sourceId: string;
  indexed: number;
  skipped: number;
}

export async function indexLocalDocsSource(db: SignalDeskDb, source: LocalDocsSourceConfig): Promise<DocsIndexResult> {
  const repo = new LocalDocsRepo(db);
  const files = await walkFiles(source.path);
  let indexed = 0;
  let skipped = 0;
  for (const file of files) {
    const rel = relative(source.path, file);
    if (!shouldIndex(rel, source)) {
      skipped += 1;
      continue;
    }
    const content = await readFile(file, "utf8").catch(() => undefined);
    if (!content) {
      skipped += 1;
      continue;
    }
    repo.upsert({
      sourceId: source.id,
      ...(source.repo_id === undefined ? {} : { repoId: source.repo_id }),
      path: file,
      title: extractTitle(content) ?? rel,
      content
    });
    indexed += 1;
  }
  return { sourceId: source.id, indexed, skipped };
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", ".git", "dist", "build"].includes(entry.name)) {
          await walk(path);
        }
      } else if (entry.isFile()) {
        out.push(path);
      }
    }
  }
  if ((await stat(root).catch(() => undefined))?.isDirectory()) {
    await walk(root);
  }
  return out;
}

function shouldIndex(path: string, source: LocalDocsSourceConfig): boolean {
  if (source.exclude.some((pattern) => simpleMatch(path, pattern))) {
    return false;
  }
  return source.include.some((pattern) => simpleMatch(path, pattern));
}

function simpleMatch(path: string, pattern: string): boolean {
  if (pattern === "**/*.md") return path.endsWith(".md");
  if (pattern === "**/*.mdx") return path.endsWith(".mdx");
  if (pattern === "**/*.txt") return path.endsWith(".txt");
  if (pattern === "README*" || pattern === "README.md") return /(^|\/)README/i.test(path);
  if (pattern.endsWith("/**")) return path.startsWith(pattern.slice(0, -3));
  if (pattern.startsWith("**/*")) return path.toLowerCase().includes(pattern.slice(4).toLowerCase());
  return path === pattern || path.endsWith(pattern.replace(/^\*\*\//, ""));
}

function extractTitle(content: string): string | undefined {
  const line = content.split(/\r?\n/).find((candidate) => candidate.trim().startsWith("# "));
  return line?.replace(/^#\s+/, "").trim();
}
