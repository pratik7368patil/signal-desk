import { describe, expect, it } from "vitest";
import { scorePriority } from "../../src/core/priorityScorer.js";
import { testConfig } from "../helpers.js";

describe("priorityScorer", () => {
  it("marks incident keywords critical", () => {
    const result = scorePriority({
      config: testConfig(),
      event: { type: "message", channel: "C1", user: "UASK", text: "prod down customer blocker", ts: "1" }
    });

    expect(result.priority).toBe("critical");
    expect(result.reasons).toContain("incident_keywords");
  });

  it("marks direct mentions high", () => {
    const result = scorePriority({
      config: testConfig(),
      event: { type: "app_mention", channel: "C1", user: "UASK", text: "<@BOT> can you review?", ts: "1" }
    });

    expect(result.priority).toBe("high");
  });

  it("marks FYI/no-action chatter low", () => {
    const result = scorePriority({
      config: testConfig(),
      event: { type: "message", channel: "C1", user: "UASK", text: "fyi only, no action", ts: "1" }
    });

    expect(result.priority).toBe("low");
  });
});
