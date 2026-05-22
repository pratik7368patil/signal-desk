import type { AssistantConfig } from "./config/schema.js";
import type { ContextBundle } from "./context/types.js";

export type Priority = "critical" | "high" | "medium" | "low" | "ignore";

export type DraftStatus = "pending" | "posted" | "dismissed" | "failed";
export type AttentionState = "new" | "drafted" | "watching" | "posted" | "dismissed" | "snoozed" | "failed";
export type AttentionCategory =
  | "direct_mention"
  | "personal_mention"
  | "waiting_on_me"
  | "watched_thread"
  | "incident"
  | "fyi_batch";
export type WatchedThreadStatus = "active" | "stopped";

export type SlackTriggerType = "app_mention" | "personal_mention" | "message_shortcut" | "dm_command";

export interface SlackMessageLike {
  type: string;
  channel: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  hidden?: boolean;
}

export interface SlackEventEnvelope {
  event_id?: string;
  team_id?: string;
  event: SlackMessageLike;
}

export interface TriggerDecision {
  matched: boolean;
  triggerType?: SlackTriggerType;
  reasons: string[];
}

export interface PriorityDecision {
  priority: Priority;
  reasons: string[];
}

export interface SlackContextMessage {
  user?: string;
  text: string;
  ts: string;
  channel?: string;
}

export interface SlackContext {
  channel: string;
  threadTs: string;
  originalTs: string;
  originalText: string;
  originalUser?: string;
  permalink?: string;
  messages: SlackContextMessage[];
  truncated: boolean;
}

export interface RepoSnippet {
  repoId: string;
  title?: string;
  path?: string;
  text: string;
  score?: number;
}

export interface AnchorQueryResult {
  available: boolean;
  snippets: RepoSnippet[];
  errors: string[];
}

export interface AgentPrompt {
  system: string;
  rules: string[];
  return_contract: {
    draft: string;
    confidence: string;
    assumptions: string[];
    sources: string[];
    needs_human_review: true;
  };
  slack_context: SlackContext;
  selected_repositories: Array<{
    id: string;
    path: string;
    snippets: RepoSnippet[];
  }>;
  context_bundle?: ContextBundle;
  priority: PriorityDecision;
  assumptions: string[];
  user_profile?: {
    role: string;
    teams: string[];
    owned_systems: string[];
    preferred_tone: string;
    escalation_style: string;
    default_uncertainty_language: string;
    writing_style?: {
      preferred_format: string;
      notes: string[];
      examples: string[];
    };
  };
}

export interface AgentResult {
  draft: string;
  confidence: number;
  assumptions: string[];
  sources: string[];
  needs_human_review: boolean;
}

export interface StoredDraft {
  id: string;
  eventIdentity: string;
  channel: string;
  threadTs: string;
  originalTs: string;
  originalUser?: string;
  priority: Priority;
  selectedRepos: string[];
  selectedAgent: string;
  promptHash: string;
  promptJson: string;
  draft: string;
  confidence: number;
  assumptions: string[];
  sources: string[];
  status: DraftStatus;
  dmChannel?: string;
  dmTs?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AttentionItem {
  id: string;
  eventIdentity: string;
  draftId?: string;
  category: AttentionCategory;
  priority: Exclude<Priority, "ignore">;
  state: AttentionState;
  channel: string;
  threadTs: string;
  originalTs: string;
  permalink?: string;
  title: string;
  summary: string;
  reasons: string[];
  metadata: Record<string, unknown>;
  snoozedUntil?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WatchedThread {
  id: string;
  channel: string;
  threadTs: string;
  permalink?: string;
  reason: string;
  status: WatchedThreadStatus;
  lastSeenTs?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DraftCreationResult {
  created: boolean;
  draft?: StoredDraft;
  reason?: string;
}

export interface SlackWebClientLike {
  chat: {
    postMessage(args: Record<string, unknown>): Promise<Record<string, unknown>>;
    getPermalink?(args: Record<string, unknown>): Promise<Record<string, unknown>>;
    update?(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  conversations: {
    open?(args: Record<string, unknown>): Promise<Record<string, unknown>>;
    replies?(args: Record<string, unknown>): Promise<Record<string, unknown>>;
    history?(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  search?: {
    messages?(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  users?: {
    info?(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  auth?: {
    test?(args?: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  views?: {
    open(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  reactions?: {
    add(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
}

export interface RuntimeServices {
  config: AssistantConfig;
}
