import type { AssistantConfig } from "../config/schema.js";
import type { SlackContext, SlackContextMessage, SlackMessageLike, SlackWebClientLike } from "../types.js";
import { redactSlackText } from "../utils/redact.js";

export class SlackContextCollector {
  constructor(
    private readonly config: AssistantConfig,
    private readonly client: SlackWebClientLike
  ) {}

  async collect(event: SlackMessageLike): Promise<SlackContext> {
    const threadTs = event.thread_ts ?? event.ts;
    const messages: SlackContextMessage[] = [];
    const historyMessages = await this.collectHistory(event);
    messages.push(...historyMessages);
    const threadMessages = await this.collectThread(event.channel, threadTs);
    messages.push(...threadMessages);

    if (messages.length === 0) {
      messages.push(this.normalizeMessage(event));
    }

    const deduped = dedupeMessages(messages);
    const budgeted = applyContextBudget(deduped, this.config.context.max_slack_context_chars);
    const permalink = await this.getPermalink(event.channel, event.ts);

    const base = {
      channel: event.channel,
      threadTs,
      originalTs: event.ts,
      originalText: this.redact(event.text ?? ""),
      messages: budgeted.messages,
      truncated: budgeted.truncated
    };

    return {
      ...base,
      ...(event.user === undefined ? {} : { originalUser: event.user }),
      ...(permalink === undefined ? {} : { permalink })
    };
  }

  private async collectThread(channel: string, threadTs: string): Promise<SlackContextMessage[]> {
    if (!this.client.conversations.replies) {
      return [];
    }
    try {
      const result = await this.client.conversations.replies({
        channel,
        ts: threadTs,
        limit: this.config.context.thread_replies_limit
      });
      const rows = Array.isArray(result.messages) ? result.messages : [];
      return rows.map((row) => this.normalizeUnknownMessage(row, channel)).filter((row): row is SlackContextMessage => row !== undefined);
    } catch {
      return [];
    }
  }

  private async collectHistory(event: SlackMessageLike): Promise<SlackContextMessage[]> {
    if (!this.client.conversations.history || this.config.context.channel_history_before_message === 0) {
      return [];
    }
    try {
      const result = await this.client.conversations.history({
        channel: event.channel,
        latest: event.ts,
        inclusive: false,
        limit: this.config.context.channel_history_before_message
      });
      const rows = Array.isArray(result.messages) ? result.messages : [];
      return rows
        .map((row) => this.normalizeUnknownMessage(row, event.channel))
        .filter((row): row is SlackContextMessage => row !== undefined)
        .reverse();
    } catch {
      return [];
    }
  }

  private async getPermalink(channel: string, messageTs: string): Promise<string | undefined> {
    if (!this.client.chat.getPermalink) {
      return undefined;
    }
    try {
      const result = await this.client.chat.getPermalink({ channel, message_ts: messageTs });
      return typeof result.permalink === "string" ? result.permalink : undefined;
    } catch {
      return undefined;
    }
  }

  private normalizeMessage(event: SlackMessageLike): SlackContextMessage {
    return {
      ...(event.user === undefined ? {} : { user: event.user }),
      text: this.redact(event.text ?? ""),
      ts: event.ts,
      channel: event.channel
    };
  }

  private normalizeUnknownMessage(row: unknown, channel: string): SlackContextMessage | undefined {
    if (typeof row !== "object" || row === null) {
      return undefined;
    }
    const value = row as Record<string, unknown>;
    const text = typeof value.text === "string" ? value.text : "";
    const ts = typeof value.ts === "string" ? value.ts : undefined;
    if (!ts) {
      return undefined;
    }
    return {
      ...(typeof value.user === "string" ? { user: value.user } : {}),
      text: this.redact(text),
      ts,
      channel
    };
  }

  private redact(text: string): string {
    return redactSlackText(text, {
      redactEmails: this.config.security.redact_slack_user_emails
    });
  }
}

function dedupeMessages(messages: SlackContextMessage[]): SlackContextMessage[] {
  const seen = new Set<string>();
  const result: SlackContextMessage[] = [];
  for (const message of messages) {
    const key = `${message.channel ?? ""}:${message.ts}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(message);
  }
  return result;
}

function applyContextBudget(
  messages: SlackContextMessage[],
  maxChars: number
): { messages: SlackContextMessage[]; truncated: boolean } {
  let remaining = maxChars;
  const kept: SlackContextMessage[] = [];
  let truncated = false;

  for (const message of messages) {
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const text = message.text.length > remaining ? `${message.text.slice(0, Math.max(0, remaining - 16))}\n[truncated]` : message.text;
    if (text.length < message.text.length) {
      truncated = true;
    }
    kept.push({ ...message, text });
    remaining -= text.length;
  }

  return { messages: kept, truncated };
}
