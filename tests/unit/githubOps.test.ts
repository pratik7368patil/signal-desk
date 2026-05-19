import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureConfigFile, readMutableConfig } from "../../src/cli/configOps.js";
import { parseRepoSelection, runGitHubSetup } from "../../src/cli/githubOps.js";
import type { RunCommandOptions, RunCommandResult } from "../../src/utils/shell.js";

function ok(stdout = ""): RunCommandResult {
  return { code: 0, stdout, stderr: "", timedOut: false };
}

describe("github setup", () => {
  it("parses numbered, range, and manual-add selections", () => {
    expect(parseRepoSelection("1, 3-4 a", 5)).toEqual({
      indices: [0, 2, 3],
      addManual: true,
      quit: false
    });
    expect(parseRepoSelection("q", 5)).toEqual({
      indices: [],
      addManual: false,
      quit: true
    });
  });

  it("selects GitHub repos, writes config, and indexes with the local gh token", async () => {
    const directory = mkdtempSync(join(tmpdir(), "signald-gh-"));
    const configPath = join(directory, "assistant.config.yaml");
    ensureConfigFile(configPath);
    const repoPath = join(directory, "code", "payments-service");
    const indexCalls: Array<{ args: string[]; options?: RunCommandOptions }> = [];

    const run = async (command: string, args: string[], options?: RunCommandOptions): Promise<RunCommandResult> => {
      if (command === "gh" && args.join(" ") === "auth status --hostname github.com") {
        return ok();
      }
      if (command === "gh" && args[0] === "repo" && args[1] === "list") {
        return ok(JSON.stringify([{ nameWithOwner: "acme/payments-service", isPrivate: true }]));
      }
      if (command === "gh" && args.join(" ") === "auth token") {
        return ok("ghs_local_token\n");
      }
      if (command === "anchor") {
        indexCalls.push({ args, ...(options === undefined ? {} : { options }) });
        return ok("indexed");
      }
      return { code: 1, stdout: "", stderr: `unexpected ${command} ${args.join(" ")}`, timedOut: false };
    };

    try {
      const result = await runGitHubSetup(configPath, {
        root: join(directory, "code"),
        prompt: async () => "1",
        log: () => {},
        commandExists: async () => true,
        run,
        discover: async () => [{ path: repoPath, id: "payments-service", githubRepo: "acme/payments-service" }],
        pathExists: (pathValue) => pathValue === repoPath
      });

      const config = readMutableConfig(configPath);
      expect(result.addedRepos.map((repo) => repo.github_repo)).toEqual(["acme/payments-service"]);
      expect(config.repositories[0]?.path).toBe(repoPath);
      expect(indexCalls[0]?.args).toEqual(["index", "--repo", "acme/payments-service", "--limit", "200"]);
      expect(indexCalls[0]?.options?.cwd).toBe(repoPath);
      expect(indexCalls[0]?.options?.env?.GH_TOKEN).toBe("ghs_local_token");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("can add and clone a repository not shown in the picker", async () => {
    const directory = mkdtempSync(join(tmpdir(), "signald-gh-"));
    const configPath = join(directory, "assistant.config.yaml");
    ensureConfigFile(configPath);
    const prompts = ["a", "acme/new-api", ""];
    const cloneCalls: string[][] = [];

    const run = async (command: string, args: string[]): Promise<RunCommandResult> => {
      if (command === "gh" && args.join(" ") === "auth status --hostname github.com") {
        return ok();
      }
      if (command === "gh" && args[0] === "repo" && args[1] === "list") {
        return ok("[]");
      }
      if (command === "gh" && args[0] === "repo" && args[1] === "clone") {
        cloneCalls.push(args);
        return ok("cloned");
      }
      return { code: 1, stdout: "", stderr: `unexpected ${command} ${args.join(" ")}`, timedOut: false };
    };

    try {
      const result = await runGitHubSetup(configPath, {
        root: join(directory, "code"),
        prompt: async () => prompts.shift() ?? "",
        log: () => {},
        commandExists: async () => true,
        run,
        discover: async () => [],
        pathExists: () => false,
        mkdir: async () => {},
        yes: true,
        autoIndex: false
      });

      expect(result.addedRepos.map((repo) => repo.github_repo)).toEqual(["acme/new-api"]);
      expect(cloneCalls[0]?.slice(0, 3)).toEqual(["repo", "clone", "acme/new-api"]);
      expect(readMutableConfig(configPath).repositories[0]?.id).toBe("new-api");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
