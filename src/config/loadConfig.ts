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
  return {
    config_version: 1,
    local_docs: [],
    tools: { providers: [] },
    ...value
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
