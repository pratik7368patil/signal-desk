import { existsSync } from "node:fs";
import { basename } from "node:path";
import { AnchorClient } from "../anchor/anchorClient.js";
import { getAgent } from "../agents/agentRegistry.js";
import { loadConfig } from "../config/loadConfig.js";
import { loadSlackInstallation } from "../slack/oauth.js";
import { openDatabase } from "../storage/sqlite.js";
import { commandExists } from "../utils/shell.js";
import { isRunningFromPidFile } from "./serviceOps.js";

export type DoctorLevel = "pass" | "warn" | "fail";

export interface DoctorCheck {
  level: DoctorLevel;
  name: string;
  message: string;
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
  } catch (error) {
    checks.push({ level: "fail", name: "config", message: String(error) });
    return checks;
  }

  checks.push({
    level: process.env.SLACK_APP_TOKEN ? "pass" : "fail",
    name: "slack app token",
    message: process.env.SLACK_APP_TOKEN ? "SLACK_APP_TOKEN configured for Socket Mode" : "Set SLACK_APP_TOKEN to an xapp token"
  });

  const installation = await loadSlackInstallation(config);
  checks.push({
    level: installation?.botToken ? "pass" : "warn",
    name: "slack oauth",
    message: installation?.botToken ? "Local Slack bot token stored" : "Run `sig slack login` or set SLACK_BOT_TOKEN"
  });
  checks.push({
    level: installation?.userToken || process.env.SLACK_USER_TOKEN ? "pass" : "warn",
    name: "slack user token",
    message: installation?.userToken || process.env.SLACK_USER_TOKEN ? "User token available for personal context/Post as Me" : "Run `sig slack login` with user scopes for Post as Me"
  });

  try {
    const db = openDatabase(process.env.SIGNALD_DB_PATH ?? ".signald.sqlite");
    db.close();
    checks.push({ level: "pass", name: "sqlite", message: "SQLite database opens and migrations run" });
  } catch (error) {
    checks.push({ level: "fail", name: "sqlite", message: String(error) });
  }

  const anchorInstalled = await commandExists("anchor");
  checks.push({
    level: anchorInstalled ? "pass" : "warn",
    name: "anchor",
    message: anchorInstalled ? "anchor binary found" : "Install @pratik7368patil/anchor for PR-history context"
  });

  const anchorClient = new AnchorClient();
  for (const repo of config.repositories) {
    const repoPathExists = existsSync(repo.path);
    checks.push({
      level: repoPathExists ? "pass" : "warn",
      name: `repo:${repo.id}`,
      message: repoPathExists ? repo.path : `Missing path ${repo.path}`
    });
    if (repo.anchor.enabled) {
      if (!repoPathExists) {
        checks.push({
          level: "warn",
          name: `anchor:${repo.id}`,
          message: "Skipped Anchor status because the repository path is missing"
        });
        continue;
      }
      const status = await anchorClient.status(repo);
      checks.push({
        level: status.ok ? "pass" : "warn",
        name: `anchor:${repo.id}`,
        message: status.message
      });
    }
  }

  for (const source of config.local_docs) {
    checks.push({
      level: existsSync(source.path) ? "pass" : "warn",
      name: `docs:${source.id}`,
      message: existsSync(source.path) ? source.path : `Missing docs path ${source.path}`
    });
  }

  try {
    const agent = getAgent(config);
    const binary = agent.command[0] ?? "";
    checks.push({
      level: binary && (await commandExists(binary)) ? "pass" : "warn",
      name: "agent",
      message: binary && (await commandExists(binary)) ? `${agent.id}: ${basename(binary)}` : `${agent.id}: ${binary || "missing command"} not found`
    });
  } catch (error) {
    checks.push({ level: "fail", name: "agent", message: String(error) });
  }

  checks.push({
    level: isRunningFromPidFile() ? "pass" : "warn",
    name: "daemon",
    message: isRunningFromPidFile() ? "signald is running" : "signald is not running"
  });

  return checks;
}

export function printDoctor(checks: DoctorCheck[]): void {
  for (const check of checks) {
    const label = check.level.toUpperCase().padEnd(4);
    console.log(`${label} ${check.name}: ${check.message}`);
  }
}
