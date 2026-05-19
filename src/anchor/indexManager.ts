import type { RepositoryConfig } from "../config/schema.js";
import { allowlistedEnv, commandExists, runCommand } from "../utils/shell.js";
import type { RunCommandResult } from "../utils/shell.js";

export function isSecretPattern(pattern: string): boolean {
  return /(^|[/\\])\.env|pem$|\.key$|secret|token|credential|password/i.test(pattern);
}

export function buildAnchorIndexArgs(repo: RepositoryConfig): string[] {
  const anchor = repo.anchor;
  const args = [anchor.sync_on_index ? "sync" : "index"];
  if (repo.github_repo) {
    args.push("--repo", repo.github_repo);
  }
  if (anchor.index_all) {
    args.push("--all");
  } else {
    args.push("--limit", String(anchor.index_limit));
  }
  if (anchor.index_concurrency !== undefined) {
    args.push("--concurrency", String(anchor.index_concurrency));
  }
  return args;
}

export interface IndexRepositoryResult {
  repoId: string;
  ok: boolean;
  message: string;
}

export async function indexRepositories(
  repos: RepositoryConfig[],
  options: {
    binary?: string;
    exists?: (binary: string) => Promise<boolean>;
    run?: (command: string, args: string[], options?: Parameters<typeof runCommand>[2]) => Promise<RunCommandResult>;
    extraEnv?: NodeJS.ProcessEnv;
  } = {}
): Promise<IndexRepositoryResult[]> {
  const fallbackBinary = options.binary ?? "anchor";
  const exists = options.exists ?? commandExists;
  const run = options.run ?? runCommand;

  const results: IndexRepositoryResult[] = [];
  for (const repo of repos) {
    if (!repo.anchor.enabled) {
      results.push({
        repoId: repo.id,
        ok: false,
        message: "anchor disabled for repository"
      });
      continue;
    }
    const binary = repo.anchor.command[0] ?? fallbackBinary;
    if (!(await exists(binary))) {
      results.push({
        repoId: repo.id,
        ok: false,
        message: "anchor binary not found"
      });
      continue;
    }
    const result = await run(binary, buildAnchorIndexArgs(repo), {
      timeoutMs: 10 * 60_000,
      env: anchorEnv(repo.anchor.env_allowlist, options.extraEnv),
      cwd: repo.path
    });
    results.push({
      repoId: repo.id,
      ok: result.code === 0,
      message: result.code === 0 ? result.stdout.trim() : result.stderr.trim()
    });
  }
  return results;
}

function anchorEnv(allowlist: string[], extraEnv: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = allowlistedEnv(allowlist);
  for (const key of allowlist) {
    const value = extraEnv[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}
