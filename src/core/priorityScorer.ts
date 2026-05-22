import type { AssistantConfig } from "../config/schema.js";
import type { PriorityDecision, SlackMessageLike } from "../types.js";
import { containsUserMention, isBotMessage } from "./triggerRouter.js";

const criticalPatterns = [
  /\bincident\b/i,
  /\bprod(?:uction)? down\b/i,
  /\boutage\b/i,
  /\bsev\s*1\b/i,
  /\bp0\b/i,
  /\bcustomer blocker\b/i,
  /\bdata loss\b/i
];

const waitingPatterns = [
  /\bwaiting on you\b/i,
  /\bblocked on you\b/i,
  /\bneed your (?:input|review|approval)\b/i,
  /\bcan you\b/i,
  /\bplease review\b/i
];

const lowPatterns = [
  /\bfyi\b/i,
  /\bthanks\b/i,
  /\bthank you\b/i,
  /\bno action\b/i,
  /\bjust sharing\b/i
];

const resolvedPatterns = [
  /\bresolved\b/i,
  /\bfixed\b/i,
  /\bnvm\b/i,
  /\bnever mind\b/i,
  /\bignore this\b/i
];

export interface PriorityInput {
  event: SlackMessageLike;
  config: AssistantConfig;
  directMention?: boolean;
  ownedRepoMentioned?: boolean;
  ownedChannel?: boolean;
  incidentChannel?: boolean;
}

export function scorePriority(input: PriorityInput): PriorityDecision {
  const text = input.event.text ?? "";
  const reasons: string[] = [];

  if (isBotMessage(input.event)) {
    return { priority: "ignore", reasons: ["bot_noise"] };
  }

  if (input.config.triggers.personal_mentions.excluded_channels.includes(input.event.channel)) {
    return { priority: "ignore", reasons: ["excluded_channel"] };
  }

  if (resolvedPatterns.some((pattern) => pattern.test(text))) {
    return { priority: "ignore", reasons: ["resolved_thread"] };
  }

  if (input.incidentChannel || criticalPatterns.some((pattern) => pattern.test(text))) {
    reasons.push(input.incidentChannel ? "incident_channel" : "incident_keywords");
    return { priority: "critical", reasons };
  }

  if (lowPatterns.some((pattern) => pattern.test(text)) && !waitingPatterns.some((pattern) => pattern.test(text))) {
    return { priority: "low", reasons: ["fyi_or_no_action"] };
  }

  const directMention =
    input.directMention ?? (input.event.type === "app_mention" || containsUserMention(text, input.config.profile.slack_user_id));
  if (directMention) {
    reasons.push("direct_mention");
  }

  if (waitingPatterns.some((pattern) => pattern.test(text))) {
    reasons.push("waiting_on_user");
  }

  if (input.ownedRepoMentioned) {
    reasons.push("owned_repo_mentioned");
  }

  if (input.ownedChannel) {
    reasons.push("owned_channel");
  }

  if (reasons.length > 0) {
    return { priority: "high", reasons };
  }

  return { priority: "medium", reasons: ["discussion_likely_relevant"] };
}
