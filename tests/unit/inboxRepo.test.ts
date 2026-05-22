import { describe, expect, it } from "vitest";
import { AttentionRepo } from "../../src/storage/attentionRepo.js";
import { openDatabase } from "../../src/storage/sqlite.js";

describe("AttentionRepo", () => {
  it("creates, lists, dismisses, and snoozes attention items", () => {
    const db = openDatabase(":memory:");
    const repo = new AttentionRepo(db);

    const item = repo.upsertFromEvent({
      eventIdentity: "EvInbox",
      category: "direct_mention",
      priority: "high",
      state: "new",
      channel: "C123",
      threadTs: "100.000",
      originalTs: "101.000",
      title: "Mention in #payments",
      summary: "Can you review this?",
      reasons: ["direct_mention"]
    });

    expect(item.id).toBeTruthy();
    expect(repo.list({ limit: 10 })[0]).toMatchObject({
      id: item.id,
      category: "direct_mention",
      state: "new",
      priority: "high"
    });

    repo.attachDraft(item.id, "draft-1");
    expect(repo.get(item.id)?.state).toBe("drafted");

    repo.snooze(item.id, "2026-05-22T10:00:00.000Z");
    expect(repo.get(item.id)).toMatchObject({
      state: "snoozed",
      snoozedUntil: "2026-05-22T10:00:00.000Z"
    });

    repo.dismiss(item.id);
    expect(repo.get(item.id)?.state).toBe("dismissed");
  });

  it("keeps event identity idempotent", () => {
    const db = openDatabase(":memory:");
    const repo = new AttentionRepo(db);

    const first = repo.upsertFromEvent({
      eventIdentity: "EvSame",
      category: "direct_mention",
      priority: "high",
      state: "new",
      channel: "C123",
      threadTs: "100.000",
      originalTs: "101.000",
      title: "First",
      summary: "First summary",
      reasons: ["direct_mention"]
    });
    const second = repo.upsertFromEvent({
      eventIdentity: "EvSame",
      category: "waiting_on_me",
      priority: "high",
      state: "new",
      channel: "C123",
      threadTs: "100.000",
      originalTs: "101.000",
      title: "Second",
      summary: "Second summary",
      reasons: ["waiting_on_user"]
    });

    expect(second.id).toBe(first.id);
    expect(repo.list({ limit: 10 })).toHaveLength(1);
  });
});
