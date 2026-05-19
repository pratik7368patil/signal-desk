import { existsSync } from "node:fs";
import { ensureConfigFile, migrateConfigFile } from "./configOps.js";
import { commandExists } from "../utils/shell.js";

export interface InitResult {
  configCreatedOrChanged: boolean;
  messages: string[];
}

export async function runInit(configPath: string, options: { dryRun?: boolean; migrate?: boolean } = {}): Promise<InitResult> {
  const existed = existsSync(configPath);
  const result = existed && options.migrate ? migrateConfigFile(configPath, { write: !options.dryRun }) : ensureConfigFile(configPath, options);
  const messages: string[] = [];
  messages.push(`${existed ? "Checked" : options.dryRun ? "Would create" : "Created"} ${configPath}`);
  messages.push(`Node ${process.versions.node}`);
  messages.push((await commandExists("anchor")) ? "Anchor detected" : "Anchor not found; install with `npm install -g @pratik7368patil/anchor`");
  messages.push((await commandExists("gh")) ? "GitHub CLI detected" : "GitHub CLI not found; install `gh` for private repo PR history");
  messages.push("Next: set SLACK_APP_TOKEN, SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, then run `sig slack login`.");
  messages.push("Next: run `sig github setup ~/code` to pick GitHub repos, add them to config, and index them.");
  messages.push("Next: add docs with `sig docs add <path>`.");
  return {
    configCreatedOrChanged: result.changed,
    messages
  };
}
