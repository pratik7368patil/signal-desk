import { basename } from "node:path";
import type { AssistantConfig, RepositoryConfig } from "../config/schema.js";
import type { SlackContext, SlackMessageLike } from "../types.js";

export interface RepoSelection {
  repos: RepositoryConfig[];
  reasons: Record<string, string[]>;
}

export function selectRepositories(
  config: AssistantConfig,
  input: SlackContext | SlackMessageLike | { channel: string; text?: string }
): RepoSelection {
  const channel = input.channel;
  const text = extractText(input);
  const selected = new Map<string, { repo: RepositoryConfig; reasons: string[] }>();

  for (const repo of config.repositories) {
    if (repo.channels.includes(channel)) {
      selected.set(repo.id, { repo, reasons: ["channel_match"] });
    }
  }

  for (const repo of config.repositories) {
    if (matchesRepoKeyword(repo, text)) {
      const current = selected.get(repo.id);
      if (current) {
        current.reasons.push("keyword_match");
      } else {
        selected.set(repo.id, { repo, reasons: ["keyword_match"] });
      }
    }
  }

  if (selected.size === 0) {
    for (const repo of config.repositories.filter((repo) => repo.channels.length === 0)) {
      selected.set(repo.id, { repo, reasons: ["default_repo"] });
    }
  }

  return {
    repos: [...selected.values()].map((value) => value.repo),
    reasons: Object.fromEntries([...selected.values()].map((value) => [value.repo.id, value.reasons]))
  };
}

export function mentionsOwnedRepo(config: AssistantConfig, text: string): boolean {
  return config.repositories.some((repo) => matchesRepoKeyword(repo, text));
}

function extractText(input: SlackContext | SlackMessageLike | { channel: string; text?: string }): string {
  if ("messages" in input) {
    return [input.originalText, ...input.messages.map((message) => message.text)].join("\n");
  }
  return input.text ?? "";
}

function matchesRepoKeyword(repo: RepositoryConfig, text: string): boolean {
  const normalized = text.toLowerCase();
  const pathName = basename(repo.path).toLowerCase();
  const candidates = new Set([
    repo.id.toLowerCase(),
    repo.id.toLowerCase().replace(/[-_]/g, " "),
    pathName,
    pathName.replace(/[-_]/g, " ")
  ]);

  for (const candidate of candidates) {
    if (!candidate || candidate.length < 3) {
      continue;
    }
    if (new RegExp(`\\b${escapeRegExp(candidate)}\\b`, "i").test(normalized)) {
      return true;
    }
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
