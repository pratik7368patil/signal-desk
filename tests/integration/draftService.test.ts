import { describe, expect, it } from "vitest";
import { AnchorClient } from "../../src/anchor/anchorClient.js";
import { CliAgent } from "../../src/agents/cliAgent.js";
import { DraftService } from "../../src/core/draftService.js";
import { handlePostAction } from "../../src/slack/actions.js";
import { AttentionRepo } from "../../src/storage/attentionRepo.js";
import { openDatabase } from "../../src/storage/sqlite.js";
import { fakeSlackClient, testConfig } from "../helpers.js";

function validCliAgent() {
  return new CliAgent({
    runner: async () => ({
      code: 0,
      stdout: JSON.stringify({
        draft: "I can take a look. Based on the thread, I need the failing request id to be precise.",
        confidence: 0.74,
        assumptions: ["No request id was included."],
        sources: ["Slack thread"],
        needs_human_review: true
      }),
      stderr: "",
      timedOut: false
    })
  });
}

describe("DraftService", () => {
  it("stores a draft and sends it privately for an app_mention", async () => {
    const db = openDatabase(":memory:");
    const { client, postCalls, reactionCalls } = fakeSlackClient();
    const service = new DraftService({
      config: testConfig(),
      client,
      db,
      anchorClient: new AnchorClient({ exists: async () => false }),
      cliAgent: validCliAgent()
    });

    const result = await service.handleEvent({
      event_id: "Ev1",
      event: { type: "app_mention", channel: "C123", user: "UASK", text: "<@BOT> help with payments", ts: "123.000" }
    });

    expect(result.created).toBe(true);
    expect(result.draft?.status).toBe("pending");
    expect(service.draftsRepo.getDraft(result.draft!.id)).toBeDefined();
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0]?.channel).toBe("DME");
    expect(new AttentionRepo(db).list({ limit: 10 })[0]).toMatchObject({
      eventIdentity: "Ev1",
      category: "direct_mention",
      state: "drafted",
      priority: "high",
      draftId: result.draft!.id
    });
    expect(reactionCalls).toContainEqual({
      channel: "C123",
      timestamp: "123.000",
      name: "eyes"
    });
  });

  it("batches low-priority items without creating an immediate draft", async () => {
    const db = openDatabase(":memory:");
    const { client, postCalls } = fakeSlackClient();
    const service = new DraftService({
      config: testConfig({
        triggers: {
          bot_mentions: { enabled: true },
          personal_mentions: {
            enabled: true,
            allowed_channels: [],
            excluded_channels: [],
            ignore_bots: true,
            ignore_self: true
          }
        },
        inbox: {
          enabled: true,
          batch_low_priority: true,
          retention_days: 14
        }
      }),
      client,
      db,
      anchorClient: new AnchorClient({ exists: async () => false }),
      cliAgent: validCliAgent()
    });

    const result = await service.handleEvent({
      event_id: "EvLow",
      event: { type: "message", channel: "C123", user: "UASK", text: "<@UME> fyi no action", ts: "123.500" }
    });

    expect(result.created).toBe(false);
    expect(result.reason).toBe("low_priority_batched");
    expect(postCalls).toHaveLength(0);
    expect(new AttentionRepo(db).list({ limit: 10 })[0]).toMatchObject({
      eventIdentity: "EvLow",
      category: "fyi_batch",
      state: "new",
      priority: "low"
    });
  });

  it("does not automatically post publicly during event handling", async () => {
    const db = openDatabase(":memory:");
    const { client, postCalls } = fakeSlackClient();
    const service = new DraftService({
      config: testConfig(),
      client,
      db,
      anchorClient: new AnchorClient({ exists: async () => false }),
      cliAgent: validCliAgent()
    });

    await service.handleEvent({
      event_id: "Ev2",
      event: { type: "app_mention", channel: "CPUBLIC", user: "UASK", text: "<@BOT> can you reply?", ts: "124.000" }
    });

    expect(postCalls).toHaveLength(1);
    expect(postCalls[0]?.channel).toBe("DME");
    expect(postCalls.some((call) => call.channel === "CPUBLIC")).toBe(false);
  });

  it("falls back to posting a draft DM by user id when opening the DM is missing scope", async () => {
    const db = openDatabase(":memory:");
    const { client, postCalls } = fakeSlackClient();
    client.conversations.open = async () => {
      throw Object.assign(new Error("missing_scope"), { data: { error: "missing_scope" } });
    };
    const service = new DraftService({
      config: testConfig(),
      client,
      db,
      anchorClient: new AnchorClient({ exists: async () => false }),
      cliAgent: validCliAgent()
    });

    const result = await service.handleEvent({
      event_id: "EvDmFallback",
      event: { type: "app_mention", channel: "CPUBLIC", user: "UASK", text: "<@BOT> can you reply?", ts: "124.250" }
    });

    expect(result.created).toBe(true);
    expect(result.draft?.status).toBe("pending");
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0]?.channel).toBe("UME");
    expect(service.auditRepo.list().some((row) => row.action === "draft_dm_open_fallback")).toBe(true);
  });

  it("marks the draft failed when private DM delivery fails", async () => {
    const db = openDatabase(":memory:");
    const { client } = fakeSlackClient();
    client.chat.postMessage = async () => {
      throw Object.assign(new Error("missing_scope"), { data: { error: "missing_scope" } });
    };
    const service = new DraftService({
      config: testConfig(),
      client,
      db,
      anchorClient: new AnchorClient({ exists: async () => false }),
      cliAgent: validCliAgent()
    });

    const result = await service.handleEvent({
      event_id: "EvDmFailure",
      event: { type: "app_mention", channel: "CPUBLIC", user: "UASK", text: "<@BOT> can you reply?", ts: "124.300" }
    });

    expect(result.created).toBe(true);
    expect(service.draftsRepo.getDraft(result.draft!.id)?.status).toBe("failed");
    expect(service.auditRepo.list().some((row) => row.action === "draft_dm_failed")).toBe(true);
  });

  it("still creates a draft when adding the trigger reaction fails", async () => {
    const db = openDatabase(":memory:");
    const { client, postCalls } = fakeSlackClient();
    client.reactions = {
      add: async () => {
        throw Object.assign(new Error("missing_scope"), { data: { error: "missing_scope" } });
      }
    };
    const service = new DraftService({
      config: testConfig(),
      client,
      db,
      anchorClient: new AnchorClient({ exists: async () => false }),
      cliAgent: validCliAgent()
    });

    const result = await service.handleEvent({
      event_id: "EvReactionFailure",
      event: { type: "app_mention", channel: "CPUBLIC", user: "UASK", text: "<@BOT> can you reply?", ts: "124.500" }
    });

    expect(result.created).toBe(true);
    expect(postCalls).toHaveLength(1);
    expect(service.auditRepo.list().some((row) => row.action === "trigger_reaction_failed")).toBe(true);
  });

  it("posts to the original thread only after explicit Post click", async () => {
    const db = openDatabase(":memory:");
    const { client, postCalls } = fakeSlackClient();
    const service = new DraftService({
      config: testConfig(),
      client,
      db,
      anchorClient: new AnchorClient({ exists: async () => false }),
      cliAgent: validCliAgent()
    });
    const result = await service.handleEvent({
      event_id: "Ev3",
      event: {
        type: "app_mention",
        channel: "CPUBLIC",
        user: "UASK",
        text: "<@BOT> can you reply?",
        ts: "125.000",
        thread_ts: "120.000"
      }
    });

    let acked = false;
    await handlePostAction(
      {
        ack: () => {
          acked = true;
        },
        body: { actions: [{ value: result.draft!.id }] }
      },
      service
    );

    expect(acked).toBe(true);
    expect(postCalls).toHaveLength(2);
    expect(postCalls[1]).toMatchObject({
      channel: "CPUBLIC",
      thread_ts: "120.000"
    });
    expect(service.draftsRepo.getDraft(result.draft!.id)?.status).toBe("posted");
    expect(new AttentionRepo(db).list({ limit: 10, includeDismissed: true })[0]?.state).toBe("posted");
  });

  it("uses a Slack user token client for approved posting when available", async () => {
    const db = openDatabase(":memory:");
    const { client: botClient, postCalls: botPostCalls } = fakeSlackClient();
    const { client: userClient, postCalls: userPostCalls } = fakeSlackClient();
    const service = new DraftService({
      config: testConfig(),
      client: botClient,
      userClient,
      db,
      anchorClient: new AnchorClient({ exists: async () => false }),
      cliAgent: validCliAgent()
    });
    const result = await service.handleEvent({
      event_id: "Ev4",
      event: {
        type: "app_mention",
        channel: "CPUBLIC",
        user: "UASK",
        text: "<@BOT> can you reply?",
        ts: "126.000",
        thread_ts: "120.000"
      }
    });

    await handlePostAction(
      {
        ack: () => undefined,
        body: { actions: [{ value: result.draft!.id }] }
      },
      service
    );

    expect(botPostCalls).toHaveLength(1);
    expect(botPostCalls[0]?.channel).toBe("DME");
    expect(userPostCalls).toContainEqual(
      expect.objectContaining({
        channel: "CPUBLIC",
        thread_ts: "120.000"
      })
    );
  });
});
