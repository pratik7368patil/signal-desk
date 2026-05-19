import type { McpServerConfig, RepositoryConfig } from "../config/schema.js";
import type { AnchorQueryResult, RepoSnippet } from "../types.js";
import { McpToolClient } from "../mcp/mcpClient.js";
import { commandExists } from "../utils/shell.js";

export interface AnchorClientOptions {
  binary?: string;
  exists?: (binary: string) => Promise<boolean>;
  mcpClient?: McpToolClient;
}

export class AnchorClient {
  private readonly binary: string;
  private readonly exists: (binary: string) => Promise<boolean>;
  private readonly mcpClient: McpToolClient;

  constructor(options: AnchorClientOptions = {}) {
    this.binary = options.binary ?? "anchor";
    this.exists = options.exists ?? commandExists;
    this.mcpClient = options.mcpClient ?? new McpToolClient();
  }

  async status(repo: RepositoryConfig): Promise<{ available: boolean; ok: boolean; message: string }> {
    if (!(await this.binaryAvailable(repo))) {
      return { available: false, ok: false, message: "anchor binary not found" };
    }
    try {
      const result = await this.mcpClient.callTool(anchorServerConfig(repo, this.binary), "anchor_index_status", {});
      return {
        available: true,
        ok: result.ok,
        message: result.text
      };
    } catch (error) {
      return {
        available: true,
        ok: false,
        message: `anchor status failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  async query(repos: RepositoryConfig[], query: string, limit = 8): Promise<AnchorQueryResult> {
    const enabledRepos = repos.filter((repo) => repo.anchor.enabled);
    if (enabledRepos.length === 0) {
      return { available: true, snippets: [], errors: [] };
    }

    const snippets: RepoSnippet[] = [];
    const errors: string[] = [];
    let missingBinary = false;

    for (const repo of enabledRepos) {
      if (!(await this.binaryAvailable(repo))) {
        missingBinary = true;
        errors.push(`${repo.id}: anchor binary not found; generated draft with Slack-only context`);
        continue;
      }

      try {
        const result = await this.mcpClient.callTool(anchorServerConfig(repo, this.binary), "anchor_get_context", {
          task: query,
          maxResults: Math.min(Math.max(limit, 1), 12)
        });

        if (!result.ok || result.isError) {
          errors.push(`${repo.id}: ${result.text || "anchor_get_context failed"}`);
          continue;
        }

        const score = extractScore(result.structuredContent);
        snippets.push({
          repoId: repo.id,
          title: "Anchor PR history",
          text: result.text,
          ...(score === undefined ? {} : { score })
        });
      } catch (error) {
        errors.push(`${repo.id}: ${String(error)}`);
      }
    }

    return {
      available: !missingBinary,
      snippets,
      errors
    };
  }

  private async binaryAvailable(repo: RepositoryConfig): Promise<boolean> {
    const command = repo.anchor.command[0] ?? this.binary;
    return this.exists(command);
  }
}

export function anchorServerConfig(repo: RepositoryConfig, fallbackBinary = "anchor"): McpServerConfig {
  const [command, ...args] = repo.anchor.command.length > 0 ? repo.anchor.command : [fallbackBinary, "serve"];
  return {
    id: `anchor-${repo.id}`,
    enabled: repo.anchor.enabled,
    command: [command ?? fallbackBinary, ...args],
    cwd: repo.path,
    env_allowlist: repo.anchor.env_allowlist,
    timeout_seconds: 20,
    local_only: true,
    read_only: true,
    allowed_tools: ["anchor_get_context", "anchor_search_history", "anchor_index_status"]
  };
}

function extractScore(metadata: Record<string, unknown> | undefined): number | undefined {
  const items = metadata?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return undefined;
  }
  const first = items[0] as Record<string, unknown>;
  return typeof first.score === "number" ? first.score : undefined;
}
