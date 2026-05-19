import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSlackAuthorizeUrl,
  exchangeSlackOAuthCode,
  loadSlackInstallation,
  resolveSlackBotToken,
  saveSlackInstallation,
  slackRedirectUri
} from "../../src/slack/oauth.js";
import { testConfig } from "../helpers.js";

describe("Slack OAuth", () => {
  it("builds an OAuth authorize URL with scopes, redirect URI, and state", () => {
    const config = testConfig();
    const url = new URL(buildSlackAuthorizeUrl(config, { clientId: "client.123", clientSecret: "secret" }, "state-123"));

    expect(url.origin + url.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(url.searchParams.get("client_id")).toBe("client.123");
    expect(url.searchParams.get("redirect_uri")).toBe(slackRedirectUri(config));
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("scope")).toContain("app_mentions:read");
    expect(url.searchParams.get("scope")).toContain("chat:write");
  });

  it("exchanges an OAuth code without sending the client secret in the form body", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return {
        ok: true,
        statusText: "OK",
        json: async () => ({
          ok: true,
          access_token: "xoxb-installed",
          token_type: "bot",
          scope: "app_mentions:read,chat:write",
          app_id: "A123",
          bot_user_id: "Ubot",
          team: { id: "T123", name: "Team" }
        })
      } as Response;
    }) as typeof fetch;

    const installation = await exchangeSlackOAuthCode({
      code: "code-123",
      redirectUri: "http://127.0.0.1:31337/slack/oauth/callback",
      credentials: { clientId: "client.123", clientSecret: "secret-value" },
      fetchImpl
    });

    expect(installation.botToken).toBe("xoxb-installed");
    expect(installation.botScopes).toEqual(["app_mentions:read", "chat:write"]);
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: expect.stringMatching(/^Basic /),
      "Content-Type": "application/x-www-form-urlencoded"
    });
    expect(String(calls[0]?.init.body)).not.toContain("secret-value");
  });

  it("stores and resolves the local installation token", async () => {
    const config = testConfig();
    const dir = await mkdtemp(join(tmpdir(), "signald-oauth-test-"));
    config.slack.oauth.installation_store = join(dir, "slack-installation.json");

    await saveSlackInstallation(config, {
      botToken: "xoxb-saved",
      botScopes: ["chat:write"],
      userScopes: [],
      installedAt: "2026-05-19T00:00:00.000Z"
    });

    await expect(loadSlackInstallation(config)).resolves.toMatchObject({ botToken: "xoxb-saved" });
    await expect(resolveSlackBotToken(config, {})).resolves.toBe("xoxb-saved");
    await expect(resolveSlackBotToken(config, { SLACK_BOT_TOKEN: "xoxb-env" })).resolves.toBe("xoxb-env");

    const file = await stat(config.slack.oauth.installation_store);
    expect(file.mode & 0o777).toBe(0o600);
  });
});
