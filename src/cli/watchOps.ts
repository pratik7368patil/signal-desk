import { parseSlackThreadLink } from "../core/watchThreads.js";
import { openDatabase } from "../storage/sqlite.js";
import { WatchRepo } from "../storage/watchRepo.js";

export function watchThreadFromLink(link: string, reason = "cli"): void {
  const parsed = parseSlackThreadLink(link);
  if (!parsed) {
    throw new Error("Invalid Slack thread link. Expected a link like https://workspace.slack.com/archives/C123/p1234567890123456");
  }
  const db = openDatabase();
  try {
    const watched = new WatchRepo(db).watch({
      channel: parsed.channel,
      threadTs: parsed.threadTs,
      permalink: link,
      reason
    });
    console.log(`Watching ${watched.channel} ${watched.threadTs} (${watched.id})`);
  } finally {
    db.close();
  }
}

export function listWatchedThreads(options: { json?: boolean } = {}): void {
  const db = openDatabase();
  try {
    const watched = new WatchRepo(db).list();
    if (options.json) {
      console.log(JSON.stringify({ watched }, null, 2));
      return;
    }
    if (watched.length === 0) {
      console.log("No watched threads.");
      return;
    }
    for (const item of watched) {
      console.log(`${item.id}\t${item.status}\t${item.channel}\t${item.threadTs}\t${item.reason}`);
    }
  } finally {
    db.close();
  }
}

export function stopWatchedThread(id: string): void {
  const db = openDatabase();
  try {
    new WatchRepo(db).stop(id);
    console.log(`Stopped watching ${id}`);
  } finally {
    db.close();
  }
}
