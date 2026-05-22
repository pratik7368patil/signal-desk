import { spawn } from "node:child_process";
import type { AssistantConfig } from "../config/schema.js";

export function dashboardUrl(config: AssistantConfig): string {
  return `http://${config.dashboard.host}:${config.dashboard.port}/`;
}

export function openDashboard(config: AssistantConfig, options: { dryRun?: boolean } = {}): string {
  const url = dashboardUrl(config);
  if (options.dryRun) {
    return url;
  }
  const platform = process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    stdio: "ignore",
    detached: true
  });
  child.on("error", () => undefined);
  child.unref();
  return url;
}
