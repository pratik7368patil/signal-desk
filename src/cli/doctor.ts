import { existsSync } from "node:fs";
import { basename } from "node:path";
import { AnchorClient } from "../anchor/anchorClient.js";
import { getAgent } from "../agents/agentRegistry.js";
import { loadConfig } from "../config/loadConfig.js";
import { loadSlackInstallation } from "../slack/oauth.js";
import { openDatabase } from "../storage/sqlite.js";
import { commandExists } from "../utils/shell.js";
import { isRunningFromPidFile } from "./serviceOps.js";
import { migrateConfigFile } from "./configOps.js";

export type DoctorLevel = "pass" | "warn" | "fail";

export interface DoctorCheck {
  level: DoctorLevel;
  name: string;
  message: string;
  next?: string;
}

export async function runDoctor(configPath: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  checks.push({
    level: Number(process.versions.node.split(".")[0]) >= 22 ? "pass" : "warn",
    name: "node",
    message: `Node ${process.versions.node}`
  });

  let config;
  try {
    config = await loadConfig(configPath);
    checks.push({ level: "pass", name: "config", message: `${configPath} is valid` });
    const migration = migrateConfigFile(configPath, { write: false });
    if (migration.changed) {
      checks.push({
        level: "warn",
        name: "config migration",
        message: "Config can be migrated to the latest SignalDesk beta shape",
        next: `sig config migrate ${configPath} --write`
      });
    }
  } catch (error) {
    checks.push({ level: "fail", name: "config", message: String(error), next: "sig config validate" });
    return checks;
  }

  checks.push({
    level: process.env.SLACK_APP_TOKEN ? "pass" : "fail",
    name: "slack app token",
    message: process.env.SLACK_APP_TOKEN ? "SLACK_APP_TOKEN configured for Socket Mode" : "Set SLACK_APP_TOKEN to an xapp token",
    ...maybeNext(process.env.SLACK_APP_TOKEN ? undefined : "Create a Slack app-level token with connections:write and set SLACK_APP_TOKEN")
  });

  const installation = await loadSlackInstallation(config);
  checks.push({
    level: installation?.botToken ? "pass" : "warn",
    name: "slack oauth",
    message: installation?.botToken ? "Local Slack bot token stored" : "Run `sig slack login` or set SLACK_BOT_TOKEN",
    ...maybeNext(installation?.botToken ? undefined : "sig slack login")
  });
  checks.push({
    level: installation?.userToken || process.env.SLACK_USER_TOKEN ? "pass" : "warn",
    name: "slack user token",
    message: installation?.userToken || process.env.SLACK_USER_TOKEN ? "User token available for personal context/Post as Me" : "Run `sig slack login` with user scopes for Post as Me",
    ...maybeNext(installation?.userToken || process.env.SLACK_USER_TOKEN ? undefined : "Ensure Slack user scopes are in the app, then run `sig slack login`")
  });
  if (installation) {
    const missingBotScopes = missingScopes(config.slack.oauth.scopes, installation.botScopes);
    const missingUserScopes = missingScopes(config.slack.oauth.user_scopes, installation.userScopes);
    checks.push({
      level: missingBotScopes.length === 0 ? "pass" : "warn",
      name: "slack bot scopes",
      message: missingBotScopes.length === 0 ? "Required bot scopes are installed" : `Missing bot scopes: ${missingBotScopes.join(", ")}`,
      ...maybeNext(missingBotScopes.length === 0 ? undefined : "Update slack-app-manifest.yaml scopes in Slack, reinstall the app, then run `sig slack login`")
    });
    checks.push({
      level: missingUserScopes.length === 0 ? "pass" : "warn",
      name: "slack user scopes",
      message: missingUserScopes.length === 0 ? "Required user scopes are installed" : `Missing user scopes: ${missingUserScopes.join(", ")}`,
      ...maybeNext(missingUserScopes.length === 0 ? undefined : "Add user scopes in Slack OAuth settings, reinstall the app, then run `sig slack login`")
    });
  }

  try {
    const db = openDatabase(process.env.SIGNALD_DB_PATH ?? ".signald.sqlite");
    db.close();
    checks.push({ level: "pass", name: "sqlite", message: "SQLite database opens and migrations run" });
  } catch (error) {
    checks.push({ level: "fail", name: "sqlite", message: String(error), next: "Check SIGNALD_DB_PATH permissions" });
  }

  const anchorInstalled = await commandExists("anchor");
  checks.push({
    level: anchorInstalled ? "pass" : "warn",
    name: "anchor",
    message: anchorInstalled ? "anchor binary found" : "Install @pratik7368patil/anchor for PR-history context",
    ...maybeNext(anchorInstalled ? undefined : "npm install -g @pratik7368patil/anchor")
  });

  const anchorClient = new AnchorClient();
  for (const repo of config.repositories) {
    const repoPathExists = existsSync(repo.path);
    checks.push({
      level: repoPathExists ? "pass" : "warn",
      name: `repo:${repo.id}`,
      message: repoPathExists ? repo.path : `Missing path ${repo.path}`,
      ...maybeNext(repoPathExists ? undefined : "sig github setup ~/code")
    });
    if (repo.anchor.enabled) {
      if (!repoPathExists) {
        checks.push({
          level: "warn",
          name: `anchor:${repo.id}`,
          message: "Skipped Anchor status because the repository path is missing",
          next: "Fix the repository path or remove the repo from assistant.config.yaml"
        });
        continue;
      }
      const status = await anchorClient.status(repo);
      checks.push({
        level: status.ok ? "pass" : "warn",
        name: `anchor:${repo.id}`,
        message: status.message,
        ...maybeNext(status.ok ? undefined : `sig repos index`)
      });
    }
  }

  for (const source of config.local_docs) {
    checks.push({
      level: existsSync(source.path) ? "pass" : "warn",
      name: `docs:${source.id}`,
      message: existsSync(source.path) ? source.path : `Missing docs path ${source.path}`,
      ...maybeNext(existsSync(source.path) ? undefined : "Fix the docs path or remove it from assistant.config.yaml")
    });
  }

  try {
    const agent = getAgent(config);
    const binary = agent.command[0] ?? "";
    const binaryExists = Boolean(binary) && (await commandExists(binary));
    const alternatives = binaryExists ? "" : await installedAgentHint();
    checks.push({
      level: binaryExists ? "pass" : "warn",
      name: "agent",
      message: binaryExists
        ? `${agent.id}: ${basename(binary)}`
        : `${agent.id}: ${binary || "missing command"} not found${alternatives}`,
      ...maybeNext(binaryExists ? undefined : "Configure agents.available with codex, claude, ollama, or another JSON-output CLI")
    });
  } catch (error) {
    checks.push({ level: "fail", name: "agent", message: String(error), next: "Edit agents.default and agents.available in assistant.config.yaml" });
  }

  checks.push({
    level: isRunningFromPidFile() ? "pass" : "warn",
    name: "daemon",
    message: isRunningFromPidFile() ? "signald is running" : "signald is not running",
    ...maybeNext(isRunningFromPidFile() ? undefined : "sig start")
  });

  return checks;
}

export function printDoctor(checks: DoctorCheck[]): void {
  for (const check of checks) {
    const label = check.level.toUpperCase().padEnd(4);
    console.log(`${label} ${check.name}: ${check.message}`);
    if (check.next) {
      console.log(`     Next: ${check.next}`);
    }
  }
}

async function installedAgentHint(): Promise<string> {
  const installed = [];
  if (await commandExists("codex")) {
    installed.push("codex");
  }
  if (await commandExists("claude")) {
    installed.push("claude");
  }
  if (installed.length === 0) {
    return "";
  }
  return `; found ${installed.join(", ")}. Configure one under agents.available.`;
}

function missingScopes(required: string[], provided: string[]): string[] {
  const installed = new Set(provided);
  return required.filter((scope) => !installed.has(scope));
}

function maybeNext(next: string | undefined): { next?: string } {
  return next ? { next } : {};
}
