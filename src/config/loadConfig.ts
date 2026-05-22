import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import YAML from "yaml";
import { AssistantConfigSchema, type AssistantConfig } from "./schema.js";

export function expandHomePath(pathValue: string): string {
  if (pathValue === "~") {
    return homedir();
  }
  if (pathValue.startsWith("~/")) {
    return resolve(homedir(), pathValue.slice(2));
  }
  return pathValue;
}

export function normalizeConfigPaths(config: AssistantConfig): AssistantConfig {
  return {
    ...config,
    repositories: config.repositories.map((repo) => ({
      ...repo,
      path: expandHomePath(repo.path),
      ...(repo.anchor_index === undefined ? {} : { anchor_index: expandHomePath(repo.anchor_index) })
    })),
    local_docs: config.local_docs.map((source) => ({
      ...source,
      path: expandHomePath(source.path)
    })),
    mcp: {
      ...config.mcp,
      servers: config.mcp.servers.map((server) => ({
        ...server,
        ...(server.cwd === undefined ? {} : { cwd: expandHomePath(server.cwd) })
      }))
    }
  };
}

export function parseConfig(raw: unknown): AssistantConfig {
  return normalizeConfigPaths(AssistantConfigSchema.parse(migrateConfigObject(raw)));
}

export function migrateConfigObject(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return raw;
  }
  const value = raw as Record<string, unknown>;
  const tools = asRecord(value.tools);
  return {
    dashboard: { enabled: true, host: "127.0.0.1", port: 31337, ...(asRecord(value.dashboard) ?? {}) },
    inbox: { enabled: true, batch_low_priority: true, retention_days: 14, ...(asRecord(value.inbox) ?? {}) },
    watch: {
      enabled: true,
      allowed_channels: [],
      ...(asRecord(value.watch) ?? {}),
      notification_rules: {
        user_mentions: true,
        waiting_on_user: true,
        incident_language: true,
        reopened_after_minutes: 120,
        ...(asRecord(asRecord(value.watch)?.notification_rules) ?? {})
      }
    },
    ...value,
    config_version: 2,
    ...(value.local_docs === undefined ? { local_docs: [] } : {}),
    tools: { ...tools, providers: Array.isArray(tools?.providers) ? tools.providers : [] },
    ...mergeProfileWritingStyle(value)
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function mergeProfileWritingStyle(value: Record<string, unknown>): { profile?: Record<string, unknown> } {
  const profile = asRecord(value.profile);
  if (!profile) {
    return {};
  }
  return {
    profile: {
      ...profile,
      writing_style: {
        preferred_format: "concise Slack reply with short paragraphs or bullets when helpful",
        notes: [],
        examples: [],
        ...(asRecord(profile.writing_style) ?? {})
      }
    }
  };
}

export async function loadConfig(configPath = process.env.SIGNALD_CONFIG ?? "assistant.config.yaml"): Promise<AssistantConfig> {
  const text = await readFile(configPath, "utf8");
  const parsed = YAML.parse(text) as unknown;
  return parseConfig(parsed);
}

export async function validateConfigFile(configPath?: string): Promise<AssistantConfig> {
  return loadConfig(configPath);
}
