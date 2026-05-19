import { parseConfig } from "../src/config/loadConfig.js";
import type { AssistantConfig } from "../src/config/schema.js";
import type { SlackWebClientLike } from "../src/types.js";

export function testConfig(overrides: Partial<AssistantConfig> = {}): AssistantConfig {
  const base = parseConfig({
    profile: {
      slack_user_id: "UME",
      timezone: "Asia/Kolkata"
    },
    slack: {
      draft_surface: "dm",
      post_mode: "manual_only",
      max_drafts_per_hour: 20
    },
    triggers: {
      bot_mentions: {
        enabled: true
      },
      personal_mentions: {
        enabled: false,
        allowed_channels: [],
        excluded_channels: [],
        ignore_bots: true,
        ignore_self: true
      }
    },
    context: {
      thread_replies_limit: 50,
      channel_history_before_message: 0,
      max_slack_context_chars: 12000,
      store_slack_context_ttl_hours: 24
    },
    repositories: [
      {
        id: "payments",
        path: "~/code/payments-service",
        github_repo: "owner/payments-service",
        channels: ["CPAY"],
        anchor: {
          enabled: true,
          command: ["anchor", "serve"],
          index_limit: 200,
          index_all: false,
          sync_on_index: false,
          env_allowlist: ["HOME", "PATH", "GITHUB_TOKEN", "GH_TOKEN"]
        },
        include: ["src/**", "docs/**", "README.md"],
        exclude: [".env*", "**/*.pem", "**/*secret*", "node_modules/**", "build/**", "dist/**"]
      },
      {
        id: "platform",
        path: "~/code/platform",
        github_repo: "owner/platform",
        channels: [],
        anchor: {
          enabled: true,
          command: ["anchor", "serve"],
          index_limit: 200,
          index_all: false,
          sync_on_index: false,
          env_allowlist: ["HOME", "PATH", "GITHUB_TOKEN", "GH_TOKEN"]
        },
        include: ["src/**"],
        exclude: ["node_modules/**"]
      }
    ],
    mcp: {
      enabled: true,
      servers: []
    },
    agents: {
      default: "local-agent",
      available: [
        {
          id: "local-agent",
          command: ["local-llm", "chat", "--json"],
          local_only: true,
          timeout_seconds: 90
        }
      ]
    },
    focus: {
      enabled: true,
      attention_budget: {
        max_interruptions_per_hour: 3,
        batch_low_priority_every_minutes: 60
      },
      priority_model: {
        direct_mention: "high",
        owned_repo_mentioned: "high",
        incident_channel: "critical",
        waiting_on_user: "high",
        fyi_only: "low",
        bot_noise: "ignore"
      }
    },
    security: {
      require_approval_before_posting: true,
      allow_agent_file_writes: false,
      allow_network_for_agents: false,
      redact_slack_user_emails: true
    }
  });

  return mergeConfig(base, overrides);
}

export function fakeSlackClient() {
  const postCalls: Record<string, unknown>[] = [];
  const updateCalls: Record<string, unknown>[] = [];
  const viewOpenCalls: Record<string, unknown>[] = [];
  const reactionCalls: Record<string, unknown>[] = [];
  const client: SlackWebClientLike = {
    chat: {
      postMessage: async (args) => {
        postCalls.push(args);
        return {
          ok: true,
          channel: args.channel,
          ts: `${postCalls.length}.000`
        };
      },
      getPermalink: async () => ({
        ok: true,
        permalink: "https://example.slack.com/archives/C123/p123"
      }),
      update: async (args) => {
        updateCalls.push(args);
        return { ok: true };
      }
    },
    conversations: {
      open: async () => ({
        ok: true,
        channel: { id: "DME" }
      }),
      replies: async () => ({
        ok: true,
        messages: [
          { user: "UASK", text: "Can SignalDesk help with payments?", ts: "100.000" },
          { user: "UME", text: "Earlier context", ts: "101.000" }
        ]
      })
    },
    views: {
      open: async (args) => {
        viewOpenCalls.push(args);
        return { ok: true };
      }
    },
    reactions: {
      add: async (args) => {
        reactionCalls.push(args);
        return { ok: true };
      }
    }
  };

  return { client, postCalls, updateCalls, viewOpenCalls, reactionCalls };
}

function mergeConfig(config: AssistantConfig, overrides: Partial<AssistantConfig>): AssistantConfig {
  return {
    ...config,
    ...overrides,
    profile: { ...config.profile, ...overrides.profile },
    slack: { ...config.slack, ...overrides.slack },
    triggers: {
      ...config.triggers,
      ...overrides.triggers,
      bot_mentions: { ...config.triggers.bot_mentions, ...overrides.triggers?.bot_mentions },
      personal_mentions: { ...config.triggers.personal_mentions, ...overrides.triggers?.personal_mentions }
    },
    context: { ...config.context, ...overrides.context },
    mcp: { ...config.mcp, ...overrides.mcp, servers: overrides.mcp?.servers ?? config.mcp.servers },
    focus: {
      ...config.focus,
      ...overrides.focus,
      attention_budget: { ...config.focus.attention_budget, ...overrides.focus?.attention_budget },
      priority_model: { ...config.focus.priority_model, ...overrides.focus?.priority_model }
    },
    security: { ...config.security, ...overrides.security },
    repositories: overrides.repositories ?? config.repositories,
    agents: overrides.agents ?? config.agents
  };
}
