import { describe, expect, it } from "vitest";
import { parseSlackThreadLink, shouldNotifyForWatchedThread } from "../../src/core/watchThreads.js";
import { WatchRepo } from "../../src/storage/watchRepo.js";
import { openDatabase } from "../../src/storage/sqlite.js";
import { testConfig } from "../helpers.js";

describe("watched threads", () => {
  it("parses Slack thread links into channel and thread timestamps", () => {
    expect(parseSlackThreadLink("https://example.slack.com/archives/C123/p1779224021974729")).toEqual({
      channel: "C123",
      threadTs: "1779224021.974729"
    });
    expect(parseSlackThreadLink("https://example.slack.com/archives/C123/p1779224021974729?thread_ts=1779224010.111222")).toEqual({
      channel: "C123",
      threadTs: "1779224010.111222"
    });
  });

  it("stores and stops watched threads idempotently", () => {
    const db = openDatabase(":memory:");
    const repo = new WatchRepo(db);

    const first = repo.watch({
      channel: "C123",
      threadTs: "100.000",
      permalink: "https://example.slack.com/archives/C123/p100000",
      reason: "manual"
    });
    const second = repo.watch({
      channel: "C123",
      threadTs: "100.000",
      permalink: "https://example.slack.com/archives/C123/p100000",
      reason: "manual again"
    });

    expect(second.id).toBe(first.id);
    expect(repo.list()).toHaveLength(1);
    repo.stop(first.id);
    expect(repo.get(first.id)?.status).toBe("stopped");
  });

  it("notifies watched threads for mentions, waiting language, incidents, or reopen after inactivity", () => {
    const config = testConfig();

    expect(
      shouldNotifyForWatchedThread({
        config,
        event: { type: "message", channel: "C123", user: "U1", text: "<@UME> can you check?", ts: "200.000", thread_ts: "100.000" },
        watchedThread: { lastSeenTs: "199.000" }
      })
    ).toMatchObject({ notify: true, reason: "user_mentioned" });

    expect(
      shouldNotifyForWatchedThread({
        config,
        event: { type: "message", channel: "C123", user: "U1", text: "need your approval", ts: "200.000", thread_ts: "100.000" },
        watchedThread: { lastSeenTs: "199.000" }
      })
    ).toMatchObject({ notify: true, reason: "waiting_on_user" });

    expect(
      shouldNotifyForWatchedThread({
        config,
        event: { type: "message", channel: "C123", user: "U1", text: "prod down", ts: "200.000", thread_ts: "100.000" },
        watchedThread: { lastSeenTs: "199.000" }
      })
    ).toMatchObject({ notify: true, reason: "incident_language" });

    expect(
      shouldNotifyForWatchedThread({
        config,
        event: { type: "message", channel: "C123", user: "U1", text: "following up", ts: "10000.000", thread_ts: "100.000" },
        watchedThread: { lastSeenTs: "100.000" }
      })
    ).toMatchObject({ notify: true, reason: "thread_reopened" });
  });
});
