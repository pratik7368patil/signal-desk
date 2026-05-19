import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import YAML, { isScalar, isSeq } from "yaml";
import { migrateConfigObject, parseConfig } from "../config/loadConfig.js";
import type { AssistantConfig } from "../config/schema.js";

export interface ConfigMutationResult {
  changed: boolean;
  text: string;
}

export const DEFAULT_CONFIG_TEXT = `config_version: 1

profile:
  slack_user_id: "U1234567890"
  timezone: "Asia/Kolkata"
  role: ""
  teams: []
  owned_systems: []
  preferred_tone: "concise, warm, direct"
  escalation_style: "be explicit about urgency and unknowns"
  default_uncertainty_language: "I may be missing context, but based on what I can see"

slack:
  draft_surface: "dm"
  post_mode: "manual_only"
  max_drafts_per_hour: 20
  oauth:
    enabled: true
    client_id_env: "SLACK_CLIENT_ID"
    client_secret_env: "SLACK_CLIENT_SECRET"
    redirect_host: "127.0.0.1"
    redirect_port: 31337
    redirect_path: "/slack/oauth/callback"
    installation_store: "~/.config/signald/slack-installation.json"
    scopes:
      - "app_mentions:read"
      - "commands"
      - "chat:write"
      - "users:read"
      - "channels:history"
      - "reactions:write"
    user_scopes:
      - "channels:history"
      - "groups:history"
      - "im:history"
      - "mpim:history"
      - "search:read"
      - "chat:write"

triggers:
  bot_mentions:
    enabled: true
  personal_mentions:
    enabled: false
    allowed_channels: []
    excluded_channels: []
    ignore_bots: true
    ignore_self: true

context:
  thread_replies_limit: 50
  channel_history_before_message: 20
  max_slack_context_chars: 12000
  store_slack_context_ttl_hours: 24
  max_evidence_items: 24

repositories: []
local_docs: []

mcp:
  enabled: true
  servers: []

tools:
  providers: []

agents:
  default: local-agent
  available:
    - id: local-agent
      command:
        - "local-llm"
        - "chat"
        - "--json"
      local_only: true
      timeout_seconds: 90

focus:
  enabled: true
  attention_budget:
    max_interruptions_per_hour: 3
    batch_low_priority_every_minutes: 60
    quiet_hours:
      enabled: false
      start: "18:00"
      end: "09:00"
  priority_model:
    direct_mention: high
    owned_repo_mentioned: high
    incident_channel: critical
    waiting_on_user: high
    fyi_only: low
    bot_noise: ignore

security:
  require_approval_before_posting: true
  allow_agent_file_writes: false
  allow_network_for_agents: false
  redact_slack_user_emails: true
`;

export function ensureConfigFile(pathValue: string, options: { dryRun?: boolean } = {}): ConfigMutationResult {
  const target = resolve(pathValue);
  if (existsSync(target)) {
    return migrateConfigText(readFileSync(target, "utf8"));
  }
  if (!options.dryRun) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, DEFAULT_CONFIG_TEXT, { mode: 0o600 });
  }
  return { changed: true, text: DEFAULT_CONFIG_TEXT };
}

export function migrateConfigFile(pathValue: string, options: { write?: boolean } = {}): ConfigMutationResult {
  const current = existsSync(pathValue) ? readFileSync(pathValue, "utf8") : DEFAULT_CONFIG_TEXT;
  const result = migrateConfigText(current);
  if (options.write && result.changed) {
    writeFileSync(pathValue, result.text, { mode: 0o600 });
  }
  return result;
}

export function migrateConfigText(text: string): ConfigMutationResult {
  const doc = YAML.parseDocument(text);
  let changed = false;
  const ensure = (path: Array<string | number>, value: unknown) => {
    if (doc.getIn(path, true) === undefined) {
      doc.setIn(path, value);
      changed = true;
    }
  };
  const addUniqueListItem = (path: Array<string | number>, value: string) => {
    const node = doc.getIn(path, true);
    if (!isSeq(node)) {
      return;
    }
    const hasValue = node.items.some((item: unknown) => String(isScalar(item) ? item.value : item) === value);
    if (!hasValue) {
      node.add(value);
      changed = true;
    }
  };

  ensure(["config_version"], 1);
  ensure(["profile", "role"], "");
  ensure(["profile", "teams"], []);
  ensure(["profile", "owned_systems"], []);
  ensure(["profile", "preferred_tone"], "concise, warm, direct");
  ensure(["profile", "escalation_style"], "be explicit about urgency and unknowns");
  ensure(["profile", "default_uncertainty_language"], "I may be missing context, but based on what I can see");
  ensure(["slack", "oauth", "scopes"], ["app_mentions:read", "commands", "chat:write", "users:read", "channels:history", "reactions:write"]);
  ensure(["slack", "oauth", "user_scopes"], ["channels:history", "groups:history", "im:history", "mpim:history", "search:read", "chat:write"]);
  addUniqueListItem(["slack", "oauth", "scopes"], "commands");
  addUniqueListItem(["slack", "oauth", "scopes"], "reactions:write");
  ensure(["context", "max_evidence_items"], 24);
  ensure(["local_docs"], []);
  ensure(["tools"], { providers: [] });
  ensure(["tools", "providers"], []);
  ensure(["focus", "attention_budget", "quiet_hours"], { enabled: false, start: "18:00", end: "09:00" });

  return { changed, text: doc.toString() };
}

export function readMutableConfig(pathValue: string): AssistantConfig {
  const raw = existsSync(pathValue) ? YAML.parse(readFileSync(pathValue, "utf8")) : YAML.parse(DEFAULT_CONFIG_TEXT);
  return parseConfig(migrateConfigObject(raw));
}

export function writeMutableConfig(pathValue: string, config: AssistantConfig): void {
  writeFileSync(pathValue, YAML.stringify(denormalizeConfig(config)), { mode: 0o600 });
}

function denormalizeConfig(config: AssistantConfig): unknown {
  return {
    ...config,
    repositories: config.repositories,
    local_docs: config.local_docs,
    mcp: config.mcp,
    tools: config.tools
  };
}
