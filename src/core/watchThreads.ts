import type { AssistantConfig } from "../config/schema.js";
import type { SlackMessageLike, WatchedThread } from "../types.js";
import { containsUserMention } from "./triggerRouter.js";

const waitingPatterns = [
  /\bwaiting on you\b/i,
  /\bblocked on you\b/i,
  /\bneed your (?:input|review|approval)\b/i,
  /\bcan you\b/i,
  /\bplease review\b/i
];

const incidentPatterns = [/\bincident\b/i, /\bprod(?:uction)? down\b/i, /\boutage\b/i, /\bsev\s*1\b/i, /\bp0\b/i, /\bcustomer blocker\b/i];

export interface ParsedSlackThreadLink {
  channel: string;
  threadTs: string;
}

export function parseSlackThreadLink(value: string): ParsedSlackThreadLink | undefined {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  const match = url.pathname.match(/\/archives\/([^/]+)\/p(\d{10})(\d{6})/);
  if (!match) {
    return undefined;
  }
  const channel = match[1]!;
  const messageTs = `${match[2]!}.${match[3]!}`;
  const threadTs = url.searchParams.get("thread_ts") ?? messageTs;
  return { channel, threadTs };
}

export function shouldNotifyForWatchedThread(input: {
  config: AssistantConfig;
  event: SlackMessageLike;
  watchedThread: Pick<WatchedThread, "lastSeenTs">;
}): { notify: boolean; reason: string } {
  const text = input.event.text ?? "";
  const rules = input.config.watch.notification_rules;

  if (rules.user_mentions && containsUserMention(text, input.config.profile.slack_user_id)) {
    return { notify: true, reason: "user_mentioned" };
  }

  if (rules.waiting_on_user && waitingPatterns.some((pattern) => pattern.test(text))) {
    return { notify: true, reason: "waiting_on_user" };
  }

  if (rules.incident_language && incidentPatterns.some((pattern) => pattern.test(text))) {
    return { notify: true, reason: "incident_language" };
  }

  if (input.watchedThread.lastSeenTs && slackTsDeltaSeconds(input.event.ts, input.watchedThread.lastSeenTs) >= rules.reopened_after_minutes * 60) {
    return { notify: true, reason: "thread_reopened" };
  }

  return { notify: false, reason: "no_watch_rule_match" };
}

export function extractFirstSlackLink(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }
  const slackLink = text.match(/https?:\/\/[^\s>]+slack\.com\/archives\/[^\s>]+/i);
  if (slackLink) {
    return slackLink[0];
  }
  const anyArchiveLink = text.match(/https?:\/\/[^\s>]+\/archives\/[^\s>]+/i);
  return anyArchiveLink?.[0];
}

function slackTsDeltaSeconds(current: string, previous: string): number {
  const currentNumber = Number(current);
  const previousNumber = Number(previous);
  if (!Number.isFinite(currentNumber) || !Number.isFinite(previousNumber)) {
    return 0;
  }
  return currentNumber - previousNumber;
}
