import { describe, expect, it } from "vitest";
import { containsUserMention, routeTrigger } from "../../src/core/triggerRouter.js";
import { testConfig } from "../helpers.js";

describe("triggerRouter", () => {
  it("detects personal mentions using <@USER_ID>", () => {
    const config = testConfig({
      triggers: {
        bot_mentions: { enabled: true },
        personal_mentions: {
          enabled: true,
          allowed_channels: [],
          excluded_channels: [],
          ignore_bots: true,
          ignore_self: true
        }
      }
    });

    expect(containsUserMention("please ask <@UME> about this", "UME")).toBe(true);
    expect(routeTrigger({ type: "message", channel: "C1", user: "UASK", text: "ping <@UME>", ts: "1" }, config)).toMatchObject({
      matched: true,
      triggerType: "personal_mention"
    });
  });

  it("ignores bot messages", () => {
    const decision = routeTrigger(
      { type: "app_mention", channel: "C1", user: "UBOT", bot_id: "B1", text: "<@BOT> hello", ts: "1" },
      testConfig()
    );

    expect(decision).toMatchObject({ matched: false, reasons: ["bot_message"] });
  });

  it("ignores self messages", () => {
    const decision = routeTrigger(
      { type: "app_mention", channel: "C1", user: "UME", text: "<@BOT> hello", ts: "1" },
      testConfig()
    );

    expect(decision).toMatchObject({ matched: false, reasons: ["self_message"] });
  });

  it("routes app_mention triggers", () => {
    const decision = routeTrigger(
      { type: "app_mention", channel: "C1", user: "UASK", text: "<@BOT> help", ts: "1" },
      testConfig()
    );

    expect(decision).toMatchObject({ matched: true, triggerType: "app_mention" });
  });
});
