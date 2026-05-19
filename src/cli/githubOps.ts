import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { basename, dirname, join, resolve } from "node:path";
import { indexRepositories, type IndexRepositoryResult } from "../anchor/indexManager.js";
import type { RepositoryConfig } from "../config/schema.js";
import type { RunCommandOptions, RunCommandResult } from "../utils/shell.js";
import { commandExists, runCommand } from "../utils/shell.js";
import { readMutableConfig } from "./configOps.js";
import { addRepo, discoverRepos, sanitizeRepoId, type RepoDiscoveryResult } from "./repoOps.js";

export interface GitHubRepoSummary {
  nameWithOwner: string;
  url?: string;
  sshUrl?: string;
  description?: string;
  isPrivate?: boolean;
  updatedAt?: string;
}

export interface RepoSelectionParseResult {
  indices: number[];
  addManual: boolean;
  quit: boolean;
}

export interface GitHubSetupResult {
  configuredRepos: RepositoryConfig[];
  addedRepos: RepositoryConfig[];
  skippedExisting: RepositoryConfig[];
  indexResults: IndexRepositoryResult[];
}

type CommandRunner = (command: string, args: string[], options?: RunCommandOptions) => Promise<RunCommandResult>;
type PromptFn = (question: string) => Promise<string>;

export interface GitHubSetupOptions {
  root?: string;
  owner?: string;
  limit?: number;
  autoIndex?: boolean;
  yes?: boolean;
  prompt?: PromptFn;
  log?: (message: string) => void;
  commandExists?: (command: string) => Promise<boolean>;
  run?: CommandRunner;
  discover?: (root: string, maxDepth?: number) => Promise<RepoDiscoveryResult[]>;
  pathExists?: (path: string) => boolean;
  mkdir?: (path: string) => Promise<void>;
}

export async function runGitHubSetup(configPath: string, options: GitHubSetupOptions = {}): Promise<GitHubSetupResult> {
  const log = options.log ?? console.log;
  const exists = options.commandExists ?? commandExists;
  const run = options.run ?? runCommand;
  const root = resolveHome(options.root ?? defaultRepoRoot());
  const autoIndex = options.autoIndex ?? true;
  const selectedRepos: Array<{ repo: GitHubRepoSummary; localPath?: string }> = [];
  const rl =
    options.prompt === undefined
      ? createInterface({
          input,
          output
        })
      : undefined;
  const prompt = options.prompt ?? ((question: string) => rl!.question(question));

  try {
    if (!(await exists("gh"))) {
      throw new Error("GitHub CLI `gh` was not found. Install it and run `gh auth login` first.");
    }

    const auth = await run("gh", ["auth", "status", "--hostname", "github.com"], { timeoutMs: 10_000 });
    if (auth.code !== 0) {
      throw new Error(`GitHub CLI is not authenticated. Run \`gh auth login\` first.\n${auth.stderr.trim()}`);
    }

    log("Using local GitHub CLI authentication from `gh`.");
    const ghRepos = await listGitHubRepos({
      ...(options.owner === undefined ? {} : { owner: options.owner }),
      limit: options.limit ?? 50,
      run
    });
    const localRepos = await (options.discover ?? discoverRepos)(root, 4);
    const localByGitHub = new Map(
      localRepos
        .filter((repo): repo is RepoDiscoveryResult & { githubRepo: string } => repo.githubRepo !== undefined)
        .map((repo) => [repo.githubRepo.toLowerCase(), repo])
    );

    if (ghRepos.length === 0) {
      log("No GitHub repositories were returned by `gh repo list`.");
    } else {
      log(`GitHub repositories from ${options.owner ?? "your account"}:`);
      ghRepos.forEach((repo, index) => {
        const local = localByGitHub.get(repo.nameWithOwner.toLowerCase());
        const visibility = repo.isPrivate ? "private" : "public";
        log(`${index + 1}. ${repo.nameWithOwner} (${visibility})${local ? ` -> ${local.path}` : " -> not local yet"}`);
      });
    }

    log("Select repos by number or range, for example `1,3-5`.");
    log("Type `a` to add/clone a repo manually, or `q` to quit.");
    const answer = await prompt("Repos to add: ");
    const parsed = parseRepoSelection(answer, ghRepos.length);
    if (parsed.quit) {
      return { configuredRepos: [], addedRepos: [], skippedExisting: [], indexResults: [] };
    }

    for (const index of parsed.indices) {
      const repo = ghRepos[index];
      if (!repo) {
        continue;
      }
      const local = localByGitHub.get(repo.nameWithOwner.toLowerCase());
      selectedRepos.push({ repo, ...(local === undefined ? {} : { localPath: local.path }) });
    }

    if (parsed.addManual || selectedRepos.length === 0) {
      const manual = await promptManualRepo(root, prompt);
      if (manual) {
        selectedRepos.push({
          repo: { nameWithOwner: manual.nameWithOwner },
          ...(manual.localPath === undefined ? {} : { localPath: manual.localPath })
        });
      }
    }

    const configuredRepos: RepositoryConfig[] = [];
    const addedRepos: RepositoryConfig[] = [];
    const skippedExisting: RepositoryConfig[] = [];
    for (const selected of selectedRepos) {
      const localPath = await resolveLocalRepoPath(selected.repo.nameWithOwner, selected.localPath, root, {
        prompt,
        ...(options.yes === undefined ? {} : { yes: options.yes }),
        run,
        pathExists: options.pathExists ?? existsSync,
        mkdir:
          options.mkdir ??
          (async (pathValue) => {
            await mkdir(pathValue, { recursive: true });
          })
      });
      const result = addRepoIfNeeded(configPath, selected.repo.nameWithOwner, localPath);
      configuredRepos.push(result.repo);
      if (result.added) {
        addedRepos.push(result.repo);
        log(`Added ${result.repo.id}: ${result.repo.path}`);
      } else {
        skippedExisting.push(result.repo);
        log(`Already configured ${result.repo.id}: ${result.repo.path}`);
      }
    }

    const indexResults =
      autoIndex && configuredRepos.length > 0
        ? await indexRepositories(configuredRepos, {
            exists,
            run,
            extraEnv: await githubTokenEnv(run)
          })
        : [];
    for (const result of indexResults) {
      log(`${result.ok ? "ok" : "failed"} ${result.repoId}: ${result.message}`);
    }

    return { configuredRepos, addedRepos, skippedExisting, indexResults };
  } finally {
    rl?.close();
  }
}

export function parseRepoSelection(answer: string, repoCount: number): RepoSelectionParseResult {
  const normalized = answer.trim().toLowerCase();
  if (["q", "quit", "exit"].includes(normalized)) {
    return { indices: [], addManual: false, quit: true };
  }

  const indices = new Set<number>();
  let addManual = false;
  const tokens = normalized.split(/[,\s]+/).filter(Boolean);
  for (const token of tokens) {
    if (["a", "add", "new"].includes(token)) {
      addManual = true;
      continue;
    }
    const range = token.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      for (let value = Math.min(start, end); value <= Math.max(start, end); value += 1) {
        addSelectionIndex(indices, value, repoCount);
      }
      continue;
    }
    addSelectionIndex(indices, Number(token), repoCount);
  }

  return { indices: [...indices].sort((a, b) => a - b), addManual, quit: false };
}

export async function listGitHubRepos(options: { owner?: string; limit: number; run?: CommandRunner }): Promise<GitHubRepoSummary[]> {
  const run = options.run ?? runCommand;
  const args = ["repo", "list"];
  if (options.owner) {
    args.push(options.owner);
  }
  args.push("--limit", String(options.limit), "--json", "nameWithOwner,url,sshUrl,isPrivate,description,updatedAt");
  const result = await run("gh", args, { timeoutMs: 30_000 });
  if (result.code !== 0) {
    throw new Error(`Failed to list GitHub repositories with gh.\n${result.stderr.trim()}`);
  }
  const parsed = JSON.parse(result.stdout) as GitHubRepoSummary[];
  return parsed.filter((repo) => typeof repo.nameWithOwner === "string" && repo.nameWithOwner.includes("/"));
}

export async function githubTokenEnv(run: CommandRunner = runCommand): Promise<NodeJS.ProcessEnv> {
  if (process.env.GH_TOKEN) {
    return { GH_TOKEN: process.env.GH_TOKEN };
  }
  if (process.env.GITHUB_TOKEN) {
    return { GITHUB_TOKEN: process.env.GITHUB_TOKEN };
  }
  const result = await run("gh", ["auth", "token"], { timeoutMs: 10_000 });
  const token = result.stdout.trim();
  if (result.code !== 0 || token.length === 0) {
    return {};
  }
  return { GH_TOKEN: token };
}

function addSelectionIndex(indices: Set<number>, value: number, repoCount: number): void {
  if (!Number.isInteger(value) || value < 1 || value > repoCount) {
    return;
  }
  indices.add(value - 1);
}

async function promptManualRepo(root: string, prompt: PromptFn): Promise<{ nameWithOwner: string; localPath?: string } | undefined> {
  const nameWithOwner = (await prompt("GitHub repo to add (owner/repo, blank to skip): ")).trim();
  if (!/^[^/\s]+\/[^/\s]+$/.test(nameWithOwner)) {
    return undefined;
  }
  const defaultPath = join(root, nameWithOwner.split("/")[1] ?? sanitizeRepoId(nameWithOwner));
  const localPath = (await prompt(`Local path [${defaultPath}]: `)).trim();
  return {
    nameWithOwner,
    localPath: localPath.length > 0 ? resolveHome(localPath) : defaultPath
  };
}

async function resolveLocalRepoPath(
  nameWithOwner: string,
  localPath: string | undefined,
  root: string,
  deps: {
    prompt: PromptFn;
    yes?: boolean;
    run: CommandRunner;
    pathExists: (path: string) => boolean;
    mkdir: (path: string) => Promise<void>;
  }
): Promise<string> {
  const defaultPath = join(root, nameWithOwner.split("/")[1] ?? sanitizeRepoId(nameWithOwner));
  const chosenPath = localPath ?? resolveHome((await deps.prompt(`Local path for ${nameWithOwner} [${defaultPath}]: `)).trim() || defaultPath);

  if (deps.pathExists(chosenPath)) {
    return chosenPath;
  }

  const shouldClone =
    deps.yes === true
      ? true
      : !["n", "no"].includes((await deps.prompt(`Clone ${nameWithOwner} into ${chosenPath}? [Y/n]: `)).trim().toLowerCase());
  if (!shouldClone) {
    return chosenPath;
  }

  await deps.mkdir(dirname(chosenPath));
  const result = await deps.run("gh", ["repo", "clone", nameWithOwner, chosenPath], { timeoutMs: 10 * 60_000 });
  if (result.code !== 0) {
    throw new Error(`Failed to clone ${nameWithOwner}.\n${result.stderr.trim()}`);
  }
  return chosenPath;
}

function addRepoIfNeeded(configPath: string, githubRepo: string, localPath: string): { repo: RepositoryConfig; added: boolean } {
  const config = readMutableConfig(configPath);
  const normalizedPath = resolveHome(localPath);
  const existing = config.repositories.find(
    (repo) => repo.github_repo?.toLowerCase() === githubRepo.toLowerCase() || resolveHome(repo.path) === normalizedPath
  );
  if (existing) {
    return { repo: existing, added: false };
  }

  const baseId = sanitizeRepoId(basename(normalizedPath) || githubRepo.split("/")[1] || githubRepo);
  const id = uniqueRepoId(baseId, config.repositories.map((repo) => repo.id));
  return {
    repo: addRepo(configPath, {
      path: normalizedPath,
      id,
      githubRepo
    }),
    added: true
  };
}

function uniqueRepoId(baseId: string, existingIds: string[]): string {
  const existing = new Set(existingIds);
  if (!existing.has(baseId)) {
    return baseId;
  }
  for (let index = 2; ; index += 1) {
    const candidate = `${baseId}-${index}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
}

function defaultRepoRoot(): string {
  const home = process.env.HOME;
  if (home && existsSync(join(home, "code"))) {
    return join(home, "code");
  }
  return process.cwd();
}

function resolveHome(pathValue: string): string {
  if (pathValue === "~") {
    return process.env.HOME ?? pathValue;
  }
  if (pathValue.startsWith("~/")) {
    return resolve(process.env.HOME ?? ".", pathValue.slice(2));
  }
  return resolve(pathValue);
}
