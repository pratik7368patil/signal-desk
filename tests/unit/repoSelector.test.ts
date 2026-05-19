import { describe, expect, it } from "vitest";
import { selectRepositories } from "../../src/core/repoSelector.js";
import { testConfig } from "../helpers.js";

describe("repoSelector", () => {
  it("selects repositories by channel", () => {
    const result = selectRepositories(testConfig(), { channel: "CPAY", text: "hello" });

    expect(result.repos.map((repo) => repo.id)).toContain("payments");
    expect(result.reasons.payments).toContain("channel_match");
  });

  it("selects repositories by keyword", () => {
    const result = selectRepositories(testConfig(), { channel: "COTHER", text: "payments-service timeout" });

    expect(result.repos.map((repo) => repo.id)).toContain("payments");
    expect(result.reasons.payments).toContain("keyword_match");
  });
});
