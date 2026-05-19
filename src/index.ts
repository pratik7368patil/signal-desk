import "dotenv/config";
import { loadConfig } from "./config/loadConfig.js";
import { startSignalDeskApp } from "./slack/app.js";
import { logger } from "./utils/logger.js";

export async function startSignalD(configPath?: string): Promise<void> {
  const config = await loadConfig(configPath);
  await startSignalDeskApp({ config });
  logger.info("signald started with Slack Socket Mode");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startSignalD().catch((error) => {
    logger.error("signald failed to start", { error: String(error) });
    process.exitCode = 1;
  });
}
