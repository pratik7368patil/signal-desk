import { createServer, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { AssistantConfig } from "../config/schema.js";
import { expandHomePath } from "../config/loadConfig.js";
import { CascadingCredentialStore, FileCredentialStore, MacOSKeychainCredentialStore, type CredentialStore } from "../security/credentialStore.js";

const SLACK_INSTALLATION_KEY = "slack-installation";

export interface SlackInstallation {
  appId?: string;
  teamId?: string;
  teamName?: string;
  enterpriseId?: string;
  enterpriseName?: string;
  botUserId?: string;
  botToken: string;
  botScopes: string[];
  userId?: string;
  userToken?: string;
  userScopes: string[];
  tokenType?: string;
  installedAt: string;
}

export interface SlackOAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export interface SlackOAuthLoginOptions {
  openBrowser?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onAuthorizeUrl?: (url: string) => void;
}

interface OAuthAccessResponse {
  ok?: boolean;
  error?: string;
  access_token?: string;
  token_type?: string;
  scope?: string;
  app_id?: string;
  bot_user_id?: string;
  team?: {
    id?: string;
    name?: string;
  };
  authed_user?: {
    id?: string;
    access_token?: string;
    scope?: string;
  };
  enterprise?: {
    id?: string;
    name?: string;
  };
}

export function getOAuthCredentials(config: AssistantConfig, env: NodeJS.ProcessEnv = process.env): SlackOAuthCredentials {
  const clientId = env[config.slack.oauth.client_id_env];
  const clientSecret = env[config.slack.oauth.client_secret_env];
  if (!clientId || !clientSecret) {
    throw new Error(
      `${config.slack.oauth.client_id_env} and ${config.slack.oauth.client_secret_env} are required for Slack OAuth login`
    );
  }
  return { clientId, clientSecret };
}

export function slackRedirectUri(config: AssistantConfig): string {
  const { redirect_host, redirect_port, redirect_path } = config.slack.oauth;
  if (config.slack.oauth.redirect_uri) {
    return config.slack.oauth.redirect_uri;
  }
  return `http://${redirect_host}:${redirect_port}${redirect_path}`;
}

export function buildSlackAuthorizeUrl(config: AssistantConfig, credentials: SlackOAuthCredentials, state: string): string {
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", credentials.clientId);
  url.searchParams.set("scope", config.slack.oauth.scopes.join(","));
  if (config.slack.oauth.user_scopes.length > 0) {
    url.searchParams.set("user_scope", config.slack.oauth.user_scopes.join(","));
  }
  url.searchParams.set("redirect_uri", slackRedirectUri(config));
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeSlackOAuthCode(input: {
  code: string;
  redirectUri: string;
  credentials: SlackOAuthCredentials;
  fetchImpl?: typeof fetch;
}): Promise<SlackInstallation> {
  const fetcher = input.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    code: input.code,
    redirect_uri: input.redirectUri
  });
  const auth = Buffer.from(`${input.credentials.clientId}:${input.credentials.clientSecret}`).toString("base64");
  const response = await fetcher("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const payload = (await response.json()) as OAuthAccessResponse;
  if (!response.ok || !payload.ok || !payload.access_token) {
    throw new Error(`Slack OAuth exchange failed: ${payload.error ?? response.statusText}`);
  }
  return {
    ...(payload.app_id === undefined ? {} : { appId: payload.app_id }),
    ...(payload.team?.id === undefined ? {} : { teamId: payload.team.id }),
    ...(payload.team?.name === undefined ? {} : { teamName: payload.team.name }),
    ...(payload.enterprise?.id === undefined ? {} : { enterpriseId: payload.enterprise.id }),
    ...(payload.enterprise?.name === undefined ? {} : { enterpriseName: payload.enterprise.name }),
    ...(payload.bot_user_id === undefined ? {} : { botUserId: payload.bot_user_id }),
    botToken: payload.access_token,
    botScopes: parseScopes(payload.scope),
    ...(payload.authed_user?.id === undefined ? {} : { userId: payload.authed_user.id }),
    ...(payload.authed_user?.access_token === undefined ? {} : { userToken: payload.authed_user.access_token }),
    userScopes: parseScopes(payload.authed_user?.scope),
    ...(payload.token_type === undefined ? {} : { tokenType: payload.token_type }),
    installedAt: new Date().toISOString()
  };
}

export async function runSlackOAuthLogin(
  config: AssistantConfig,
  options: SlackOAuthLoginOptions = {}
): Promise<SlackInstallation> {
  if (!config.slack.oauth.enabled) {
    throw new Error("Slack OAuth login is disabled in config");
  }
  const credentials = getOAuthCredentials(config);
  const state = randomBytes(24).toString("hex");
  const authorizeUrl = buildSlackAuthorizeUrl(config, credentials, state);
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  options.onAuthorizeUrl?.(authorizeUrl);

  const installationPromise = waitForOAuthCallback(config, state, async (code) => {
    const installation = await exchangeSlackOAuthCode({
      code,
      redirectUri: slackRedirectUri(config),
      credentials,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl })
    });
    await saveSlackInstallation(config, installation);
    return installation;
  });

  if (options.openBrowser ?? true) {
    openUrl(authorizeUrl);
  }

  return withTimeout(installationPromise, timeoutMs, "Timed out waiting for Slack OAuth callback");
}

export async function resolveSlackBotToken(config: AssistantConfig, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (env.SLACK_BOT_TOKEN) {
    return env.SLACK_BOT_TOKEN;
  }
  const installation = await loadSlackInstallation(config);
  if (installation?.botToken) {
    return installation.botToken;
  }
  throw new Error("SLACK_BOT_TOKEN is not set and no local Slack installation was found. Run `sig slack login`.");
}

export async function resolveSlackUserToken(config: AssistantConfig, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  if (env.SLACK_USER_TOKEN) {
    return env.SLACK_USER_TOKEN;
  }
  const installation = await loadSlackInstallation(config);
  return installation?.userToken;
}

export async function loadSlackInstallation(config: AssistantConfig): Promise<SlackInstallation | undefined> {
  const candidates: string[] = [];
  const stored = await defaultSlackCredentialStore(config).get(SLACK_INSTALLATION_KEY).catch(() => undefined);
  if (stored) {
    candidates.push(stored);
  }
  const fileText = await readFile(slackInstallationPath(config), "utf8").catch(() => undefined);
  if (fileText) {
    candidates.push(...extractInstallationCandidates(fileText));
  }
  for (const raw of candidates) {
    const parsed = parseInstallation(raw);
    if (parsed) {
      return parsed;
    }
  }
  return undefined;
}

export async function saveSlackInstallation(config: AssistantConfig, installation: SlackInstallation): Promise<void> {
  await defaultSlackCredentialStore(config).set(SLACK_INSTALLATION_KEY, JSON.stringify(installation, null, 2));
}

export async function deleteSlackInstallation(config: AssistantConfig): Promise<void> {
  await defaultSlackCredentialStore(config).delete(SLACK_INSTALLATION_KEY);
}

export function slackInstallationPath(config: AssistantConfig): string {
  return expandHomePath(config.slack.oauth.installation_store);
}

export function defaultSlackCredentialStore(config: AssistantConfig): CredentialStore {
  return new CascadingCredentialStore(new MacOSKeychainCredentialStore("signald-slack"), new FileCredentialStore(slackInstallationPath(config)));
}

async function waitForOAuthCallback(
  config: AssistantConfig,
  expectedState: string,
  onCode: (code: string) => Promise<SlackInstallation>
): Promise<SlackInstallation> {
  const { redirect_host, redirect_port, redirect_path } = config.slack.oauth;
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        if (!req.url) {
          respond(res, 400, "Missing request URL");
          return;
        }
        const url = new URL(req.url, `http://${redirect_host}:${redirect_port}`);
        if (url.pathname !== redirect_path) {
          respond(res, 404, "Not found");
          return;
        }
        const error = url.searchParams.get("error");
        if (error) {
          respond(res, 400, `Slack authorization failed: ${escapeHtml(error)}`);
          reject(new Error(`Slack authorization failed: ${error}`));
          server.close();
          return;
        }
        if (url.searchParams.get("state") !== expectedState) {
          respond(res, 400, "Invalid OAuth state");
          reject(new Error("Invalid Slack OAuth state"));
          server.close();
          return;
        }
        const code = url.searchParams.get("code");
        if (!code) {
          respond(res, 400, "Missing OAuth code");
          reject(new Error("Missing Slack OAuth code"));
          server.close();
          return;
        }
        const installation = await onCode(code);
        respond(res, 200, "SignalDesk Slack login complete. You can close this tab.");
        resolve(installation);
        server.close();
      } catch (error) {
        respond(res, 500, "SignalDesk Slack login failed. Return to your terminal for details.");
        reject(error);
        server.close();
      }
    });
    server.on("error", reject);
    server.listen(redirect_port, redirect_host);
  });
}

function respond(res: ServerResponse, statusCode: number, message: string): void {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(`<!doctype html><title>SignalDesk</title><main><h1>${escapeHtml(message)}</h1></main>`);
}

function openUrl(url: string): void {
  const platform = process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    stdio: "ignore",
    detached: true
  });
  child.on("error", () => undefined);
  child.unref();
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

function parseScopes(scope: string | undefined): string[] {
  return scope
    ? scope
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function extractInstallationCandidates(fileText: string): string[] {
  try {
    const parsed = JSON.parse(fileText) as Record<string, unknown>;
    const wrapped = parsed[SLACK_INSTALLATION_KEY];
    return [typeof wrapped === "string" ? wrapped : undefined, fileText].filter((item): item is string => item !== undefined);
  } catch {
    return [fileText];
  }
}

function parseInstallation(raw: string): SlackInstallation | undefined {
  try {
    const parsed = JSON.parse(raw) as SlackInstallation;
    if (!parsed.botToken) {
      return undefined;
    }
    if (!Array.isArray(parsed.userScopes)) {
      parsed.userScopes = [];
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
