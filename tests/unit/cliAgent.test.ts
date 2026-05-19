import { describe, expect, it } from "vitest";
import { CliAgent, parseAgentResult } from "../../src/agents/cliAgent.js";
import { buildAgentPrompt } from "../../src/core/promptBuilder.js";
import { testConfig } from "../helpers.js";

describe("CliAgent", () => {
  it("creates fallback draft when agent returns invalid JSON", async () => {
    const cli = new CliAgent({
      runner: async () => ({
        code: 0,
        stdout: "not json",
        stderr: "",
        timedOut: false
      })
    });
    const config = testConfig();
    const prompt = buildAgentPrompt({
      slackContext: {
        channel: "C1",
        threadTs: "1",
        originalTs: "1",
        originalText: "hello",
        messages: [],
        truncated: false
      },
      selectedRepos: [],
      snippets: [],
      priority: { priority: "high", reasons: ["direct_mention"] }
    });

    const result = await cli.run(config.agents.available[0]!, prompt);

    expect(result.confidence).toBe(0);
    expect(result.needs_human_review).toBe(true);
    expect(result.assumptions[0]).toContain("invalid JSON");
  });

  it("parses a final JSON contract from noisy CLI output", () => {
    const result = parseAgentResult(`OpenAI Codex v0.130.0
--------
tokens used
10,972
{"draft":"Looks good to me.","confidence":0.8,"assumptions":["No blocker seen."],"sources":["thread"],"needs_human_review":true}`);

    expect(result).toEqual({
      draft: "Looks good to me.",
      confidence: 0.8,
      assumptions: ["No blocker seen."],
      sources: ["thread"],
      needs_human_review: true
    });
  });

  it("parses JSON contract nested in a CLI result field", () => {
    const result = parseAgentResult(
      JSON.stringify({
        type: "result",
        result: JSON.stringify({
          draft: "I can take this.",
          confidence: 0.7,
          assumptions: [],
          sources: ["thread"],
          needs_human_review: true
        })
      })
    );

    expect(result.draft).toBe("I can take this.");
    expect(result.sources).toEqual(["thread"]);
  });
});
