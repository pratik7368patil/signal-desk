import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { createDashboardServer } from "../../src/dashboard/server.js";
import { AttentionRepo } from "../../src/storage/attentionRepo.js";
import { openDatabase } from "../../src/storage/sqlite.js";
import { testConfig } from "../helpers.js";

describe("dashboard server", () => {
  it("serves sanitized status and inbox APIs", async () => {
    const db = openDatabase(":memory:");
    const config = testConfig();
    new AttentionRepo(db).upsertFromEvent({
      eventIdentity: "EvDash",
      category: "direct_mention",
      priority: "high",
      state: "new",
      channel: "C123",
      threadTs: "100.000",
      originalTs: "101.000",
      title: "Mention in C123",
      summary: "Can you review?",
      reasons: ["direct_mention"]
    });

    const server = createDashboardServer({
      config,
      db,
      status: {
        daemon: "running",
        slack: {
          socketMode: true,
          appTokenConfigured: true,
          botTokenAvailable: true,
          userTokenAvailable: true,
          missingBotScopes: [],
          missingUserScopes: []
        }
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("missing server address");
    }

    try {
      const status = (await fetch(`http://127.0.0.1:${address.port}/api/status`).then((response) => response.json())) as {
        status: { slack: { appTokenConfigured: boolean } };
      };
      expect(JSON.stringify(status)).not.toContain("xox");
      expect(status.status.slack.appTokenConfigured).toBe(true);

      const inbox = (await fetch(`http://127.0.0.1:${address.port}/api/inbox`).then((response) => response.json())) as {
        items: Array<Record<string, unknown>>;
      };
      expect(inbox.items).toHaveLength(1);
      expect(inbox.items[0]).toMatchObject({ title: "Mention in C123", state: "new" });
    } finally {
      server.close();
    }
  });
});
