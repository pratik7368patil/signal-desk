import "dotenv/config";
import { loadConfig } from "./config/loadConfig.js";
import { startDashboardServer } from "./dashboard/server.js";
import { startSignalDeskApp } from "./slack/app.js";
import { loadSlackInstallation } from "./slack/oauth.js";
import { openDatabase } from "./storage/sqlite.js";
import { logger } from "./utils/logger.js";

export async function startSignalD(configPath?: string): Promise<void> {
  const config = await loadConfig(configPath);
  const db = openDatabase();
  const installation = await loadSlackInstallation(config);
  const dashboard = startDashboardServer({
    config,
    db,
    status: {
      daemon: "running",
      slack: {
        socketMode: Boolean(process.env.SLACK_APP_TOKEN),
        appTokenConfigured: Boolean(process.env.SLACK_APP_TOKEN),
        botTokenAvailable: Boolean(installation?.botToken || process.env.SLACK_BOT_TOKEN),
        userTokenAvailable: Boolean(installation?.userToken || process.env.SLACK_USER_TOKEN),
        missingBotScopes: missingScopes(config.slack.oauth.scopes, installation?.botScopes ?? []),
        missingUserScopes: missingScopes(config.slack.oauth.user_scopes, installation?.userScopes ?? [])
      }
    }
  });
  dashboard?.on("error", (error) => {
    logger.warn("dashboard failed", { error: String(error) });
  });
  try {
    await startSignalDeskApp({ config, db });
    logger.info("signald started with Slack Socket Mode");
  } catch (error) {
    logger.warn("signald dashboard started, but Slack Socket Mode did not start", { error: String(error) });
  }
}

function missingScopes(required: string[], provided: string[]): string[] {
  if (provided.length === 0) {
    return required;
  }
  const set = new Set(provided);
  return required.filter((scope) => !set.has(scope));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startSignalD().catch((error) => {
    logger.error("signald failed to start", { error: String(error) });
    process.exitCode = 1;
  });
}
