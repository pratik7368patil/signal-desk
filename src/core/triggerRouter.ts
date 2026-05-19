import type { AssistantConfig } from "../config/schema.js";
import type { SlackMessageLike, TriggerDecision } from "../types.js";

export function eventIdentity(event: SlackMessageLike, eventId?: string): string {
  return eventId ?? `${event.channel}:${event.ts}`;
}

export function isBotMessage(event: SlackMessageLike): boolean {
  return Boolean(event.bot_id) || event.subtype === "bot_message";
}

export function isSelfMessage(event: SlackMessageLike, config: AssistantConfig): boolean {
  return event.user === config.profile.slack_user_id;
}

export function containsUserMention(text: string | undefined, userId: string): boolean {
  if (!text) {
    return false;
  }
  return new RegExp(`<@${escapeRegExp(userId)}(?:\\|[^>]+)?>`).test(text);
}

export function routeTrigger(event: SlackMessageLike, config: AssistantConfig): TriggerDecision {
  if (event.hidden) {
    return { matched: false, reasons: ["hidden_message"] };
  }

  if (isBotMessage(event)) {
    return { matched: false, reasons: ["bot_message"] };
  }

  if (event.type === "app_mention") {
    if (!config.triggers.bot_mentions.enabled) {
      return { matched: false, reasons: ["bot_mentions_disabled"] };
    }
    return { matched: true, triggerType: "app_mention", reasons: ["app_mention"] };
  }

  if (event.type !== "message") {
    return { matched: false, reasons: ["unsupported_event_type"] };
  }

  if (isDmCommand(event)) {
    return { matched: true, triggerType: "dm_command", reasons: ["dm_command"] };
  }

  const personal = config.triggers.personal_mentions;
  if (!personal.enabled) {
    return { matched: false, reasons: ["personal_mentions_disabled"] };
  }

  if (personal.ignore_bots && isBotMessage(event)) {
    return { matched: false, reasons: ["bot_message"] };
  }

  if (personal.ignore_self && isSelfMessage(event, config)) {
    return { matched: false, reasons: ["self_message"] };
  }

  if (personal.excluded_channels.includes(event.channel)) {
    return { matched: false, reasons: ["excluded_channel"] };
  }

  if (personal.allowed_channels.length > 0 && !personal.allowed_channels.includes(event.channel)) {
    return { matched: false, reasons: ["channel_not_allowed"] };
  }

  if (!containsUserMention(event.text, config.profile.slack_user_id)) {
    return { matched: false, reasons: ["no_personal_mention"] };
  }

  return { matched: true, triggerType: "personal_mention", reasons: ["personal_mention"] };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isDmCommand(event: SlackMessageLike): boolean {
  if (!event.channel.startsWith("D")) {
    return false;
  }
  return /\b(watch this thread|draft (?:a )?reply|help me reply)\b/i.test(event.text ?? "");
}
