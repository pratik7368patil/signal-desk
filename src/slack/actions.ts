import type { DraftService } from "../core/draftService.js";
import type { SlackMessageLike, SlackWebClientLike } from "../types.js";
import { ACTION_IDS, buildEditModal, SHORTCUT_IDS, VIEW_IDS } from "./draftMessages.js";

export interface BoltActionArgs {
  ack: () => Promise<void> | void;
  body: Record<string, unknown>;
  client?: SlackWebClientLike;
}

export function registerActions(app: any, service: DraftService): void {
  app.action(ACTION_IDS.edit, async (args: BoltActionArgs) => handleEditAction(args, service));
  app.action(ACTION_IDS.regenerate, async (args: BoltActionArgs) => handleRegenerateAction(args, service));
  app.action(ACTION_IDS.post, async (args: BoltActionArgs) => handlePostAction(args, service));
  app.action(ACTION_IDS.dismiss, async (args: BoltActionArgs) => handleDismissAction(args, service));
  app.action(ACTION_IDS.explainSources, async (args: BoltActionArgs) => handleExplainSourcesAction(args, service));
  if (typeof app.shortcut === "function") {
    app.shortcut(SHORTCUT_IDS.draftWithSignalDesk, async (args: BoltActionArgs) => handleMessageShortcutAction(args, service));
    app.shortcut(SHORTCUT_IDS.watchWithSignalDesk, async (args: BoltActionArgs) => handleWatchShortcutAction(args, service));
  }
  app.view(VIEW_IDS.editDraft, async (args: { ack: () => Promise<void> | void; body: Record<string, unknown>; view: Record<string, unknown> }) =>
    handleEditSubmission(args, service)
  );
}

export async function handlePostAction(args: BoltActionArgs, service: DraftService): Promise<void> {
  await args.ack();
  const draftId = extractDraftId(args.body);
  await service.postDraft(draftId);
}

export async function handleDismissAction(args: BoltActionArgs, service: DraftService): Promise<void> {
  await args.ack();
  const draftId = extractDraftId(args.body);
  await service.dismissDraft(draftId);
}

export async function handleRegenerateAction(args: BoltActionArgs, service: DraftService): Promise<void> {
  await args.ack();
  const draftId = extractDraftId(args.body);
  await service.regenerateDraft(draftId);
}

export async function handleExplainSourcesAction(args: BoltActionArgs, service: DraftService): Promise<void> {
  await args.ack();
  const draftId = extractDraftId(args.body);
  const explanation = service.explainSources(draftId);
  const channel = extractResponseChannel(args.body);
  if (channel && args.client?.chat.postMessage) {
    await args.client.chat.postMessage({
      channel,
      text: explanation
    });
  }
}

export async function handleEditAction(args: BoltActionArgs, service: DraftService): Promise<void> {
  await args.ack();
  const draftId = extractDraftId(args.body);
  const draft = service.draftsRepo.getDraft(draftId);
  if (!draft) {
    throw new Error(`Draft not found: ${draftId}`);
  }
  const triggerId = typeof args.body.trigger_id === "string" ? args.body.trigger_id : undefined;
  if (!triggerId || !args.client?.views?.open) {
    return;
  }
  await args.client.views.open({
    trigger_id: triggerId,
    view: buildEditModal(draft)
  });
}

export async function handleMessageShortcutAction(args: BoltActionArgs, service: DraftService): Promise<void> {
  await args.ack();
  const event = extractShortcutMessage(args.body);
  if (!event) {
    return;
  }
  await service.handleEvent({
    event_id: `shortcut:${event.channel}:${event.ts}`,
    event
  });
}

export async function handleWatchShortcutAction(args: BoltActionArgs, service: DraftService): Promise<void> {
  await args.ack();
  const event = extractShortcutMessage(args.body);
  if (!event) {
    return;
  }
  const watched = await service.watchThread({
    channel: event.channel,
    threadTs: event.thread_ts ?? event.ts,
    reason: "message_shortcut",
    lastSeenTs: event.ts
  });
  const userId = extractUserId(args.body);
  if (userId && args.client?.chat.postMessage) {
    await args.client.chat.postMessage({
      channel: userId,
      text: `Watching that thread. I will DM you only if it looks like you are needed.`
    });
  }
  service.auditRepo.record("watch_shortcut_registered", { watchedThreadId: watched.id });
}

export async function handleEditSubmission(
  args: { ack: () => Promise<void> | void; body: Record<string, unknown>; view: Record<string, unknown> },
  service: DraftService
): Promise<void> {
  await args.ack();
  const draftId = typeof args.view.private_metadata === "string" ? args.view.private_metadata : "";
  const text = extractEditedText(args.view);
  await service.editDraft(draftId, text);
}

function extractDraftId(body: Record<string, unknown>): string {
  const actions = body.actions;
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error("Missing Slack action payload");
  }
  const first = actions[0] as Record<string, unknown>;
  if (typeof first.value !== "string") {
    throw new Error("Missing draft id in Slack action");
  }
  return first.value;
}

function extractEditedText(view: Record<string, unknown>): string {
  const state = view.state as { values?: Record<string, Record<string, { value?: unknown }>> } | undefined;
  const value = state?.values?.draft?.text?.value;
  if (typeof value !== "string") {
    throw new Error("Missing edited draft text");
  }
  return value;
}

function extractResponseChannel(body: Record<string, unknown>): string | undefined {
  const channel = body.channel;
  if (typeof channel === "object" && channel !== null && typeof (channel as { id?: unknown }).id === "string") {
    return (channel as { id: string }).id;
  }
  const container = body.container;
  if (typeof container === "object" && container !== null && typeof (container as { channel_id?: unknown }).channel_id === "string") {
    return (container as { channel_id: string }).channel_id;
  }
  return undefined;
}

function extractUserId(body: Record<string, unknown>): string | undefined {
  const user = body.user;
  if (typeof user === "object" && user !== null && typeof (user as { id?: unknown }).id === "string") {
    return (user as { id: string }).id;
  }
  return undefined;
}

function extractShortcutMessage(body: Record<string, unknown>): SlackMessageLike | undefined {
  const rawMessage = body.message;
  const rawChannel = body.channel;
  if (typeof rawMessage !== "object" || rawMessage === null) {
    return undefined;
  }
  const message = rawMessage as Record<string, unknown>;
  const channel =
    typeof rawChannel === "object" && rawChannel !== null && typeof (rawChannel as { id?: unknown }).id === "string"
      ? (rawChannel as { id: string }).id
      : typeof message.channel === "string"
        ? message.channel
        : undefined;
  const ts = typeof message.ts === "string" ? message.ts : undefined;
  if (!channel || !ts) {
    return undefined;
  }
  return {
    type: "app_mention",
    channel,
    ...(typeof message.user === "string" ? { user: message.user } : {}),
    text: typeof message.text === "string" ? message.text : "",
    ts,
    ...(typeof message.thread_ts === "string" ? { thread_ts: message.thread_ts } : {})
  };
}
