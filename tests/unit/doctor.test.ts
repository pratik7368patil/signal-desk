import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG_TEXT } from "../../src/cli/configOps.js";
import { runDoctor } from "../../src/cli/doctor.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("doctor", () => {
  it("reports missing Slack scopes with actionable next steps", async () => {
    const directory = mkdtempSync(join(tmpdir(), "signald-doctor-"));
    const installationPath = join(directory, "slack-installation.json");
    const configPath = join(directory, "assistant.config.yaml");
    writeFileSync(
      configPath,
      DEFAULT_CONFIG_TEXT.replace("~/.config/signald/slack-installation.json", installationPath).replace("local-llm", "node")
    );
    writeFileSync(
      installationPath,
      JSON.stringify({
        botToken: "xoxb-redacted",
        botScopes: ["app_mentions:read", "chat:write"],
        userScopes: [],
        installedAt: "2026-05-22T00:00:00.000Z"
      })
    );
    process.env.SLACK_APP_TOKEN = "xapp-redacted";
    process.env.SIGNALD_DB_PATH = ":memory:";

    const checks = await runDoctor(configPath);

    expect(checks.find((check) => check.name === "slack bot scopes")).toMatchObject({
      level: "warn",
      message: expect.stringContaining("commands"),
      next: expect.stringContaining("reinstall")
    });
    expect(JSON.stringify(checks)).not.toContain("xoxb-redacted");
    expect(JSON.stringify(checks)).not.toContain("xapp-redacted");
  });
});
