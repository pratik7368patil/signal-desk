import { z } from "zod";

const nonEmptyString = z.string().min(1);

export const RepositorySchema = z.object({
  id: nonEmptyString.regex(/^[a-zA-Z0-9._-]+$/),
  path: nonEmptyString,
  github_repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/).optional(),
  channels: z.array(nonEmptyString).default([]),
  anchor_index: nonEmptyString.optional(),
  anchor: z
    .object({
      enabled: z.boolean().default(true),
      command: z.array(nonEmptyString).min(1).default(["anchor", "serve"]),
      index_limit: z.number().int().positive().max(1000).default(200),
      index_all: z.boolean().default(false),
      index_concurrency: z.number().int().positive().max(10).optional(),
      sync_on_index: z.boolean().default(false),
      env_allowlist: z.array(nonEmptyString).default(["HOME", "PATH", "LANG", "LC_ALL", "TZ", "TMPDIR", "GITHUB_TOKEN", "GH_TOKEN"])
    })
    .default({
      enabled: true,
      command: ["anchor", "serve"],
      index_limit: 200,
      index_all: false,
      sync_on_index: false,
      env_allowlist: ["HOME", "PATH", "LANG", "LC_ALL", "TZ", "TMPDIR", "GITHUB_TOKEN", "GH_TOKEN"]
    }),
  include: z.array(nonEmptyString).default([]),
  exclude: z.array(nonEmptyString).default([])
});

export const LocalDocsSourceSchema = z.object({
  id: nonEmptyString.regex(/^[a-zA-Z0-9._-]+$/),
  path: nonEmptyString,
  repo_id: nonEmptyString.optional(),
  include: z.array(nonEmptyString).default(["**/*.md", "**/*.mdx", "**/*.txt", "README*"]),
  exclude: z.array(nonEmptyString).default(["node_modules/**", "dist/**", "build/**", ".git/**", ".env*", "**/*.pem", "**/*secret*"])
});

export const AgentConfigSchema = z.object({
  id: nonEmptyString.regex(/^[a-zA-Z0-9._-]+$/),
  command: z.array(nonEmptyString).min(1),
  local_only: z.boolean(),
  timeout_seconds: z.number().int().positive().max(900).default(90)
});

export const McpServerConfigSchema = z.object({
  id: nonEmptyString.regex(/^[a-zA-Z0-9._-]+$/),
  enabled: z.boolean().default(true),
  command: z.array(nonEmptyString).min(1),
  cwd: nonEmptyString.optional(),
  env_allowlist: z.array(nonEmptyString).default(["HOME", "PATH", "LANG", "LC_ALL", "TZ", "TMPDIR"]),
  timeout_seconds: z.number().int().positive().max(300).default(30),
  local_only: z.literal(true).default(true),
  read_only: z.literal(true).default(true),
  allowed_tools: z.array(nonEmptyString).default([])
});

export const ToolProviderSchema = z.object({
  id: nonEmptyString.regex(/^[a-zA-Z0-9._-]+$/),
  type: z.enum(["mcp", "builtin"]).default("mcp"),
  enabled: z.boolean().default(true),
  mcp_server_id: nonEmptyString.optional(),
  tool_name: nonEmptyString.optional(),
  description: z.string().default(""),
  auth_required: z.array(nonEmptyString).default([]),
  read_only: z.literal(true).default(true)
});

export const AssistantConfigSchema = z
  .object({
    config_version: z.literal(1).default(1),
    profile: z.object({
      slack_user_id: nonEmptyString,
      timezone: nonEmptyString.default("UTC"),
      role: z.string().default(""),
      teams: z.array(nonEmptyString).default([]),
      owned_systems: z.array(nonEmptyString).default([]),
      preferred_tone: z.string().default("concise, warm, direct"),
      escalation_style: z.string().default("be explicit about urgency and unknowns"),
      default_uncertainty_language: z.string().default("I may be missing context, but based on what I can see")
    }),
    slack: z.object({
      draft_surface: z.literal("dm").default("dm"),
      post_mode: z.literal("manual_only").default("manual_only"),
      max_drafts_per_hour: z.number().int().positive().max(500).default(20),
      oauth: z
        .object({
          enabled: z.boolean().default(true),
          client_id_env: nonEmptyString.default("SLACK_CLIENT_ID"),
          client_secret_env: nonEmptyString.default("SLACK_CLIENT_SECRET"),
          redirect_host: nonEmptyString.default("127.0.0.1"),
          redirect_port: z.number().int().positive().max(65535).default(31337),
          redirect_path: nonEmptyString.default("/slack/oauth/callback"),
          redirect_uri: z.string().url().optional(),
          installation_store: nonEmptyString.default("~/.config/signald/slack-installation.json"),
          scopes: z
            .array(nonEmptyString)
            .default(["app_mentions:read", "chat:write", "users:read", "channels:history"]),
          user_scopes: z.array(nonEmptyString).default(["channels:history", "groups:history", "im:history", "mpim:history", "search:read", "chat:write"])
        })
        .default({
          enabled: true,
          client_id_env: "SLACK_CLIENT_ID",
          client_secret_env: "SLACK_CLIENT_SECRET",
          redirect_host: "127.0.0.1",
          redirect_port: 31337,
          redirect_path: "/slack/oauth/callback",
          installation_store: "~/.config/signald/slack-installation.json",
          scopes: ["app_mentions:read", "chat:write", "users:read", "channels:history"],
          user_scopes: ["channels:history", "groups:history", "im:history", "mpim:history", "search:read", "chat:write"]
        })
    }),
    triggers: z.object({
      bot_mentions: z.object({
        enabled: z.boolean().default(true)
      }),
      personal_mentions: z.object({
        enabled: z.boolean().default(false),
        allowed_channels: z.array(nonEmptyString).default([]),
        excluded_channels: z.array(nonEmptyString).default([]),
        ignore_bots: z.boolean().default(true),
        ignore_self: z.boolean().default(true)
      })
    }),
    context: z.object({
      thread_replies_limit: z.number().int().positive().max(200).default(50),
      channel_history_before_message: z.number().int().nonnegative().max(200).default(20),
      max_slack_context_chars: z.number().int().positive().max(100_000).default(12_000),
      store_slack_context_ttl_hours: z.number().int().positive().max(168).default(24),
      max_evidence_items: z.number().int().positive().max(100).default(24)
    }),
    repositories: z.array(RepositorySchema).default([]),
    local_docs: z.array(LocalDocsSourceSchema).default([]),
    mcp: z
      .object({
        enabled: z.boolean().default(true),
        servers: z.array(McpServerConfigSchema).default([])
      })
      .default({
        enabled: true,
        servers: []
      }),
    tools: z
      .object({
        providers: z.array(ToolProviderSchema).default([])
      })
      .default({
        providers: []
      }),
    agents: z.object({
      default: nonEmptyString,
      available: z.array(AgentConfigSchema).min(1)
    }),
    focus: z.object({
      enabled: z.boolean().default(true),
      attention_budget: z.object({
        max_interruptions_per_hour: z.number().int().positive().max(100).default(3),
        batch_low_priority_every_minutes: z.number().int().positive().max(1440).default(60),
        quiet_hours: z
          .object({
            enabled: z.boolean().default(false),
            start: z.string().default("18:00"),
            end: z.string().default("09:00")
          })
          .default({ enabled: false, start: "18:00", end: "09:00" })
      }),
      priority_model: z.record(z.string(), z.string()).default({})
    }),
    security: z.object({
      require_approval_before_posting: z.literal(true).default(true),
      allow_agent_file_writes: z.literal(false).default(false),
      allow_network_for_agents: z.boolean().default(false),
      redact_slack_user_emails: z.boolean().default(true)
    })
  })
  .superRefine((config, ctx) => {
    const defaultAgent = config.agents.available.find((agent) => agent.id === config.agents.default);
    if (!defaultAgent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["agents", "default"],
        message: "agents.default must reference an available agent id"
      });
    }

    if (!config.security.allow_network_for_agents) {
      for (const [index, agent] of config.agents.available.entries()) {
        if (!agent.local_only) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["agents", "available", index, "local_only"],
            message: "agent local_only must be true when network access for agents is disabled"
          });
        }
      }
    }
  });

export type AssistantConfig = z.infer<typeof AssistantConfigSchema>;
export type RepositoryConfig = z.infer<typeof RepositorySchema>;
export type LocalDocsSourceConfig = z.infer<typeof LocalDocsSourceSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type ToolProviderConfig = z.infer<typeof ToolProviderSchema>;
