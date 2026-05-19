import { App, LogLevel } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import type { AssistantConfig } from "../config/schema.js";
import { DraftService } from "../core/draftService.js";
import { openDatabase, type SignalDeskDb } from "../storage/sqlite.js";
import { registerActions } from "./actions.js";
import { registerEvents } from "./events.js";
import { resolveSlackBotToken, resolveSlackUserToken } from "./oauth.js";

export interface CreateSignalDeskAppOptions {
  config: AssistantConfig;
  db?: SignalDeskDb;
}

export async function createSignalDeskApp(options: CreateSignalDeskAppOptions): Promise<{ app: App; service: DraftService; db: SignalDeskDb }> {
  const token = await resolveSlackBotToken(options.config);
  const appToken = process.env.SLACK_APP_TOKEN;
  if (!token || !appToken) {
    throw new Error("A Slack bot token from `sig slack login` or SLACK_BOT_TOKEN, plus SLACK_APP_TOKEN, are required");
  }

  const app = new App({
    token,
    socketMode: true,
    appToken,
    logLevel: process.env.SIGNALD_LOG_LEVEL === "debug" ? LogLevel.DEBUG : LogLevel.INFO
  });

  const db = options.db ?? openDatabase();
  const userToken = await resolveSlackUserToken(options.config);
  const service = new DraftService({
    config: options.config,
    client: app.client as unknown as import("../types.js").SlackWebClientLike,
    ...(userToken === undefined ? {} : { userClient: new WebClient(userToken) as unknown as import("../types.js").SlackWebClientLike }),
    db
  });

  registerEvents(app, service);
  registerActions(app, service);

  return { app, service, db };
}

export async function startSignalDeskApp(options: CreateSignalDeskAppOptions): Promise<{ app: App; service: DraftService; db: SignalDeskDb }> {
  const runtime = await createSignalDeskApp(options);
  await runtime.app.start();
  return runtime;
}
