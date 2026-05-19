import type { AssistantConfig } from "../config/schema.js";
import { AnchorClient } from "../anchor/anchorClient.js";
import { CliAgent } from "../agents/cliAgent.js";
import { getAgent } from "../agents/agentRegistry.js";
import { buildAgentPrompt, hashPrompt } from "./promptBuilder.js";
import { mentionsOwnedRepo, selectRepositories } from "./repoSelector.js";
import { eventIdentity, routeTrigger } from "./triggerRouter.js";
import { scorePriority } from "./priorityScorer.js";
import { ContextEngine } from "../context/contextEngine.js";
import { AnchorEvidenceProvider, LocalDocsEvidenceProvider, SlackCacheEvidenceProvider, SlackEvidenceProvider } from "../context/providers.js";
import type { ContextBundle } from "../context/types.js";
import { SlackContextCollector } from "../slack/contextCollector.js";
import { buildDraftBlocks, buildDraftFallbackText } from "../slack/draftMessages.js";
import type {
  AgentPrompt,
  DraftCreationResult,
  RepoSnippet,
  SlackEventEnvelope,
  SlackMessageLike,
  SlackWebClientLike,
  StoredDraft
} from "../types.js";
import { AuditRepo } from "../storage/auditRepo.js";
import { DraftsRepo } from "../storage/draftsRepo.js";
import { SlackCacheRepo } from "../storage/slackCacheRepo.js";
import { recordEventIfNew, type SignalDeskDb } from "../storage/sqlite.js";
import { logger } from "../utils/logger.js";

export interface DraftServiceDeps {
  config: AssistantConfig;
  client: SlackWebClientLike;
  userClient?: SlackWebClientLike;
  db: SignalDeskDb;
  draftsRepo?: DraftsRepo;
  auditRepo?: AuditRepo;
  contextCollector?: SlackContextCollector;
  anchorClient?: AnchorClient;
  cliAgent?: CliAgent;
}

export class DraftService {
  readonly draftsRepo: DraftsRepo;
  readonly auditRepo: AuditRepo;
  private readonly contextCollector: SlackContextCollector;
  private readonly anchorClient: AnchorClient;
  private readonly cliAgent: CliAgent;

  constructor(private readonly deps: DraftServiceDeps) {
    this.draftsRepo = deps.draftsRepo ?? new DraftsRepo(deps.db);
    this.auditRepo = deps.auditRepo ?? new AuditRepo(deps.db);
    this.contextCollector = deps.contextCollector ?? new SlackContextCollector(deps.config, deps.userClient ?? deps.client);
    this.anchorClient = deps.anchorClient ?? new AnchorClient();
    this.cliAgent = deps.cliAgent ?? new CliAgent();
  }

  async handleEvent(envelope: SlackEventEnvelope): Promise<DraftCreationResult> {
    const { event } = envelope;
    const trigger = routeTrigger(event, this.deps.config);
    if (!trigger.matched) {
      this.auditRepo.record("event_ignored", { reasons: trigger.reasons, event: compactEvent(event) });
      return { created: false, reason: trigger.reasons.join(",") };
    }

    const identity = eventIdentity(event, envelope.event_id);
    const isNewEvent = recordEventIfNew(this.deps.db, {
      eventIdentity: identity,
      ...(envelope.event_id === undefined ? {} : { eventId: envelope.event_id }),
      event
    });
    if (!isNewEvent) {
      this.auditRepo.record("event_duplicate", { identity });
      return { created: false, reason: "duplicate_event" };
    }

    const initialPriority = scorePriority({
      event,
      config: this.deps.config,
      directMention: trigger.triggerType === "app_mention" || trigger.triggerType === "personal_mention",
      ownedRepoMentioned: mentionsOwnedRepo(this.deps.config, event.text ?? "")
    });
    if (initialPriority.priority === "ignore") {
      this.auditRepo.record("event_priority_ignored", { identity, reasons: initialPriority.reasons });
      return { created: false, reason: "priority_ignore" };
    }

    if (this.overDraftBudget()) {
      this.auditRepo.record("draft_budget_exceeded", { identity });
      return { created: false, reason: "draft_budget_exceeded" };
    }

    await this.addTriggerReaction(event, identity);

    const slackContext = await this.contextCollector.collect(event);
    new SlackCacheRepo(this.deps.db).upsertContext(slackContext, this.deps.config.context.store_slack_context_ttl_hours);
    const repoSelection = selectRepositories(this.deps.config, slackContext);
    const priority = scorePriority({
      event,
      config: this.deps.config,
      directMention: true,
      ownedRepoMentioned: repoSelection.repos.length > 0,
      ownedChannel: repoSelection.repos.some((repo) => repo.channels.includes(event.channel))
    });
    if (priority.priority === "ignore") {
      return { created: false, reason: "priority_ignore" };
    }

    const contextBundle = await this.buildContextBundle(event, slackContext, repoSelection.repos, priority);
    const assumptions = contextBundle.assumptions;

    const prompt = buildAgentPrompt({
      slackContext,
      selectedRepos: repoSelection.repos,
      snippets: snippetsFromContextBundle(contextBundle),
      priority,
      contextBundle,
      userProfile: {
        role: this.deps.config.profile.role,
        teams: this.deps.config.profile.teams,
        owned_systems: this.deps.config.profile.owned_systems,
        preferred_tone: this.deps.config.profile.preferred_tone,
        escalation_style: this.deps.config.profile.escalation_style,
        default_uncertainty_language: this.deps.config.profile.default_uncertainty_language
      },
      assumptions
    });
    const promptHash = hashPrompt(prompt);
    const agent = getAgent(this.deps.config);
    const agentResult = await this.cliAgent.run(agent, prompt);
    const draft = this.draftsRepo.createDraft({
      eventIdentity: identity,
      channel: event.channel,
      threadTs: event.thread_ts ?? event.ts,
      originalTs: event.ts,
      ...(event.user === undefined ? {} : { originalUser: event.user }),
      priority: priority.priority,
      selectedRepos: repoSelection.repos.map((repo) => repo.id),
      selectedAgent: agent.id,
      promptHash,
      prompt,
      draft: agentResult.draft,
      confidence: agentResult.confidence,
      assumptions: agentResult.assumptions,
      sources: agentResult.sources
    });

    this.auditRepo.record(
      "draft_created",
      {
        identity,
        promptHash,
        priority: priority.priority,
        priorityReasons: priority.reasons,
        selectedRepos: draft.selectedRepos,
        selectedAgent: draft.selectedAgent
      },
      draft.id
    );

    await this.sendDraftDm(draft);
    return { created: true, draft: this.draftsRepo.getDraft(draft.id) ?? draft };
  }

  async postDraft(draftId: string): Promise<StoredDraft> {
    const draft = this.requireDraft(draftId);
    if (draft.status !== "pending") {
      throw new Error(`Draft is not pending: ${draft.status}`);
    }
    if (!this.deps.config.security.require_approval_before_posting || this.deps.config.slack.post_mode !== "manual_only") {
      throw new Error("Unsafe posting configuration");
    }
    const postingClient = this.deps.userClient ?? this.deps.client;
    const postedAs = this.deps.userClient ? "user" : "bot";
    await postingClient.chat.postMessage({
      channel: draft.channel,
      thread_ts: draft.threadTs,
      text: draft.draft
    });
    this.draftsRepo.updateStatus(draft.id, "posted");
    this.auditRepo.record("draft_posted", { channel: draft.channel, threadTs: draft.threadTs, postedAs }, draft.id);
    return this.requireDraft(draft.id);
  }

  async dismissDraft(draftId: string): Promise<StoredDraft> {
    const draft = this.requireDraft(draftId);
    this.draftsRepo.updateStatus(draft.id, "dismissed");
    this.auditRepo.record("draft_dismissed", {}, draft.id);
    return this.requireDraft(draft.id);
  }

  async editDraft(draftId: string, text: string): Promise<StoredDraft> {
    const draft = this.requireDraft(draftId);
    this.draftsRepo.updateDraftContent(draft.id, {
      draft: text,
      status: "pending"
    });
    const updated = this.requireDraft(draft.id);
    this.auditRepo.record("draft_edited", {}, draft.id);
    await this.updateDraftDm(updated);
    return updated;
  }

  async regenerateDraft(draftId: string): Promise<StoredDraft> {
    const draft = this.requireDraft(draftId);
    const prompt = JSON.parse(draft.promptJson) as AgentPrompt;
    const agent = getAgent(this.deps.config, draft.selectedAgent);
    const result = await this.cliAgent.run(agent, prompt);
    this.draftsRepo.updateDraftContent(draft.id, {
      draft: result.draft,
      confidence: result.confidence,
      assumptions: result.assumptions,
      sources: result.sources,
      status: "pending"
    });
    const updated = this.requireDraft(draft.id);
    this.auditRepo.record("draft_regenerated", {}, draft.id);
    await this.updateDraftDm(updated);
    return updated;
  }

  explainSources(draftId: string): string {
    const draft = this.requireDraft(draftId);
    this.auditRepo.record("draft_sources_explained", {}, draft.id);
    return explainPromptSources(draft.promptJson);
  }

  private async sendDraftDm(draft: StoredDraft): Promise<void> {
    const dmChannel = await this.resolveDmChannel();
    const result = await this.deps.client.chat.postMessage({
      channel: dmChannel,
      text: buildDraftFallbackText(draft),
      blocks: buildDraftBlocks(draft)
    });
    const ts = typeof result.ts === "string" ? result.ts : "";
    this.draftsRepo.attachDm(draft.id, dmChannel, ts);
    this.auditRepo.record("draft_dm_sent", { dmChannel, ts }, draft.id);
  }

  private async updateDraftDm(draft: StoredDraft): Promise<void> {
    if (!draft.dmChannel || !draft.dmTs || !this.deps.client.chat.update) {
      return;
    }
    try {
      await this.deps.client.chat.update({
        channel: draft.dmChannel,
        ts: draft.dmTs,
        text: buildDraftFallbackText(draft),
        blocks: buildDraftBlocks(draft)
      });
    } catch (error) {
      logger.warn("Failed to update draft DM", { draftId: draft.id, error: String(error) });
    }
  }

  private async resolveDmChannel(): Promise<string> {
    if (!this.deps.client.conversations.open) {
      return this.deps.config.profile.slack_user_id;
    }
    const result = await this.deps.client.conversations.open({
      users: this.deps.config.profile.slack_user_id
    });
    const channel = result.channel;
    if (typeof channel === "object" && channel !== null && "id" in channel && typeof channel.id === "string") {
      return channel.id;
    }
    return this.deps.config.profile.slack_user_id;
  }

  private overDraftBudget(): boolean {
    const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    return this.draftsRepo.countDraftsSince(oneHourAgo) >= this.deps.config.slack.max_drafts_per_hour;
  }

  private async addTriggerReaction(event: SlackMessageLike, identity: string): Promise<void> {
    const reactionName = "eyes";
    if (!this.deps.client.reactions?.add) {
      this.auditRepo.record("trigger_reaction_skipped", { identity, reason: "reactions_api_unavailable" });
      return;
    }
    try {
      await this.deps.client.reactions.add({
        channel: event.channel,
        timestamp: event.ts,
        name: reactionName
      });
      this.auditRepo.record("trigger_reaction_added", { identity, name: reactionName });
    } catch (error) {
      const message = slackApiErrorMessage(error);
      if (message === "already_reacted") {
        this.auditRepo.record("trigger_reaction_skipped", { identity, reason: message });
        return;
      }
      this.auditRepo.record("trigger_reaction_failed", { identity, reason: message });
      logger.warn("Failed to add trigger reaction", { identity, reason: message });
    }
  }

  private requireDraft(draftId: string): StoredDraft {
    const draft = this.draftsRepo.getDraft(draftId);
    if (!draft) {
      throw new Error(`Draft not found: ${draftId}`);
    }
    return draft;
  }

  private async buildContextBundle(
    event: SlackMessageLike,
    slackContext: Awaited<ReturnType<SlackContextCollector["collect"]>>,
    repos: ReturnType<typeof selectRepositories>["repos"],
    priority: ReturnType<typeof scorePriority>
  ): Promise<ContextBundle> {
    const providers = [
      new SlackEvidenceProvider(this.deps.userClient ?? this.deps.client),
      new SlackCacheEvidenceProvider(this.deps.db),
      new AnchorEvidenceProvider(repos, this.anchorClient),
      ...(this.deps.config.local_docs.length > 0 ? [new LocalDocsEvidenceProvider(this.deps.db)] : [])
    ];
    return new ContextEngine(this.deps.config, this.deps.db, providers).build({
      text: buildAnchorQuery(event, slackContext.originalText),
      channel: event.channel,
      ...(event.user === undefined ? {} : { userId: event.user }),
      repos,
      slackContext,
      priority
    });
  }
}

function slackApiErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "data" in error) {
    const data = (error as { data?: { error?: unknown } }).data;
    if (typeof data?.error === "string") {
      return data.error;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function buildAnchorQuery(event: SlackMessageLike, originalText: string): string {
  return [event.text, originalText].filter(Boolean).join("\n").slice(0, 2_000);
}

function snippetsFromContextBundle(bundle: ContextBundle): RepoSnippet[] {
  return bundle.evidence
    .filter((item) => item.repoId !== undefined)
    .map((item) => ({
      repoId: item.repoId!,
      title: item.title,
      text: item.text,
      score: item.score,
      ...(item.path === undefined ? {} : { path: item.path })
    }));
}

function compactEvent(event: SlackMessageLike): Record<string, unknown> {
  return {
    type: event.type,
    channel: event.channel,
    ts: event.ts,
    user: event.user,
    subtype: event.subtype
  };
}

function explainPromptSources(promptJson: string): string {
  try {
    const prompt = JSON.parse(promptJson) as {
      context_bundle?: {
        assumptions?: unknown;
        evidence?: Array<{
          title?: unknown;
          sourceType?: unknown;
          trust?: unknown;
          repoId?: unknown;
          uri?: unknown;
        }>;
      };
      priority?: { priority?: unknown; reasons?: unknown };
    };
    const priority =
      typeof prompt.priority?.priority === "string"
        ? `Priority: ${prompt.priority.priority}${
            Array.isArray(prompt.priority.reasons) ? ` (${prompt.priority.reasons.join(", ")})` : ""
          }`
        : "Priority: unknown";
    const evidence = Array.isArray(prompt.context_bundle?.evidence) ? prompt.context_bundle.evidence : [];
    const lines = evidence.slice(0, 12).map((item, index) => {
      const title = typeof item.title === "string" ? item.title : `Evidence ${index + 1}`;
      const source = typeof item.sourceType === "string" ? item.sourceType : "context";
      const trust = typeof item.trust === "string" ? item.trust : "unknown trust";
      const repo = typeof item.repoId === "string" ? `, repo ${item.repoId}` : "";
      const uri = typeof item.uri === "string" ? `\n  ${item.uri}` : "";
      return `${index + 1}. ${title} (${source}, ${trust}${repo})${uri}`;
    });
    const assumptions = Array.isArray(prompt.context_bundle?.assumptions)
      ? prompt.context_bundle.assumptions.filter((item): item is string => typeof item === "string")
      : [];
    return [
      "*Why SignalDesk drafted this*",
      priority,
      "",
      "*Context sources used*",
      lines.length > 0 ? lines.join("\n") : "Slack thread context only.",
      assumptions.length > 0 ? `\n*Assumptions / degraded context*\n${assumptions.map((item) => `• ${item}`).join("\n")}` : ""
    ]
      .filter(Boolean)
      .join("\n");
  } catch {
    return "SignalDesk could not parse the stored prompt sources for this draft.";
  }
}
