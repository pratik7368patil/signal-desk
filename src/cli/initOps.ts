import { existsSync } from "node:fs";
import { ensureConfigFile, migrateConfigFile } from "./configOps.js";
import { commandExists } from "../utils/shell.js";

export interface InitResult {
  configCreatedOrChanged: boolean;
  messages: string[];
}

export async function runInit(configPath: string, options: { dryRun?: boolean; migrate?: boolean; yes?: boolean } = {}): Promise<InitResult> {
  const existed = existsSync(configPath);
  const result = existed && options.migrate ? migrateConfigFile(configPath, { write: !options.dryRun }) : ensureConfigFile(configPath, options);
  const messages: string[] = [];
  messages.push(`${existed ? "Checked" : options.dryRun ? "Would create" : "Created"} ${configPath}`);
  messages.push(`Node ${process.versions.node}`);
  messages.push("Slack note: SignalDesk uses a BYO Slack app. If your workspace requires admin approval, ask for approval before OAuth login.");
  messages.push(process.env.SLACK_APP_TOKEN ? "SLACK_APP_TOKEN detected" : "Next: set SLACK_APP_TOKEN to an app-level xapp token with connections:write.");
  messages.push(process.env.SLACK_CLIENT_ID ? "SLACK_CLIENT_ID detected" : "Next: set SLACK_CLIENT_ID from Slack App Credentials.");
  messages.push(process.env.SLACK_CLIENT_SECRET ? "SLACK_CLIENT_SECRET detected" : "Next: set SLACK_CLIENT_SECRET from Slack App Credentials.");
  messages.push((await commandExists("anchor")) ? "Anchor detected" : "Anchor not found; install with `npm install -g @pratik7368patil/anchor`");
  messages.push((await commandExists("gh")) ? "GitHub CLI detected" : "GitHub CLI not found; install `gh` for private repo PR history");
  const agents = await installedAgents();
  messages.push(agents.length > 0 ? `Agent CLI detected: ${agents.join(", ")}` : "No common agent CLI detected; configure agents.available in assistant.config.yaml.");
  messages.push("Next: set SLACK_APP_TOKEN, SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, then run `sig slack login`.");
  messages.push("Next: run `sig github setup ~/code` to pick GitHub repos, add them to config, and index them.");
  messages.push("Next: add docs with `sig docs add <path>`.");
  messages.push("Next: run `sig setup open` for the local dashboard.");
  return {
    configCreatedOrChanged: result.changed,
    messages
  };
}

async function installedAgents(): Promise<string[]> {
  const candidates = ["codex", "claude", "ollama", "lmstudio", "local-llm"];
  const installed: string[] = [];
  for (const candidate of candidates) {
    if (await commandExists(candidate)) {
      installed.push(candidate);
    }
  }
  return installed;
}
