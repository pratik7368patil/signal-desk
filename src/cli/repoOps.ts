import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { AssistantConfig, RepositoryConfig } from "../config/schema.js";
import { indexRepositories } from "../anchor/indexManager.js";
import { commandExists, runCommand } from "../utils/shell.js";
import { readMutableConfig, writeMutableConfig } from "./configOps.js";

export interface RepoDiscoveryResult {
  path: string;
  id: string;
  githubRepo?: string;
}

export async function discoverRepos(root: string, maxDepth = 3): Promise<RepoDiscoveryResult[]> {
  const results: RepoDiscoveryResult[] = [];
  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      return;
    }
    if (existsSync(join(directory, ".git"))) {
      const githubRepo = await inferGithubRepo(directory);
      results.push({
        path: directory,
        id: sanitizeRepoId(basename(directory)),
        ...(githubRepo === undefined ? {} : { githubRepo })
      });
      return;
    }
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || [".git", "node_modules", "Library", "dist", "build"].includes(entry.name)) {
        continue;
      }
      const child = join(directory, entry.name);
      if ((await stat(child).catch(() => undefined))?.isDirectory()) {
        await walk(child, depth + 1);
      }
    }
  }
  await walk(resolve(root), 0);
  return results;
}

export function addRepo(configPath: string, input: { path: string; id?: string; githubRepo?: string }): RepositoryConfig {
  const config = readMutableConfig(configPath);
  const id = input.id ?? sanitizeRepoId(basename(input.path));
  if (config.repositories.some((repo) => repo.id === id)) {
    throw new Error(`Repository ${id} already exists`);
  }
  const repo: RepositoryConfig = {
    id,
    path: input.path,
    ...(input.githubRepo === undefined ? {} : { github_repo: input.githubRepo }),
    channels: [],
    anchor: {
      enabled: true,
      command: ["anchor", "serve"],
      index_limit: 200,
      index_all: false,
      sync_on_index: false,
      env_allowlist: ["HOME", "PATH", "LANG", "LC_ALL", "TZ", "TMPDIR", "GITHUB_TOKEN", "GH_TOKEN"]
    },
    include: ["src/**", "docs/**", "README.md"],
    exclude: [".env*", "**/*.pem", "**/*secret*", "node_modules/**", "build/**", "dist/**"]
  };
  writeMutableConfig(configPath, {
    ...config,
    repositories: [...config.repositories, repo]
  });
  return repo;
}

export function mapRepoChannel(configPath: string, repoId: string, channel: string): RepositoryConfig {
  const config = readMutableConfig(configPath);
  const repos = config.repositories.map((repo) =>
    repo.id === repoId ? { ...repo, channels: Array.from(new Set([...repo.channels, channel])) } : repo
  );
  const repo = repos.find((candidate) => candidate.id === repoId);
  if (!repo) {
    throw new Error(`Repository ${repoId} not found`);
  }
  writeMutableConfig(configPath, { ...config, repositories: repos });
  return repo;
}

export async function syncRepos(config: AssistantConfig): Promise<Array<{ repoId: string; ok: boolean; message: string }>> {
  const repos = config.repositories.map((repo) => ({
    ...repo,
    anchor: {
      ...repo.anchor,
      sync_on_index: true
    }
  }));
  return indexRepositories(repos);
}

async function inferGithubRepo(pathValue: string): Promise<string | undefined> {
  if (!(await commandExists("git"))) {
    return undefined;
  }
  const result = await runCommand("git", ["-C", pathValue, "remote", "get-url", "origin"]);
  if (result.code !== 0) {
    return undefined;
  }
  const remote = result.stdout.trim();
  const ssh = remote.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/);
  return ssh?.[1];
}

export function sanitizeRepoId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
