import { describe, expect, it } from "vitest";
import { migrateConfigObject, parseConfig } from "../../src/config/loadConfig.js";

describe("config validation", () => {
  it("migrates older config objects to config_version 1 defaults", () => {
    const migrated = migrateConfigObject({
      profile: { slack_user_id: "UME", timezone: "Asia/Kolkata" },
      slack: { draft_surface: "dm", post_mode: "manual_only", max_drafts_per_hour: 20 },
      triggers: {
        bot_mentions: { enabled: true },
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
        channel_history_before_message: 20,
        max_slack_context_chars: 12000,
        store_slack_context_ttl_hours: 24
      },
      repositories: [],
      mcp: { enabled: true, servers: [] },
      agents: {
        default: "local-agent",
        available: [{ id: "local-agent", command: ["local"], local_only: true, timeout_seconds: 90 }]
      },
      focus: {
        enabled: true,
        attention_budget: { max_interruptions_per_hour: 3, batch_low_priority_every_minutes: 60 },
        priority_model: {}
      },
      security: {
        require_approval_before_posting: true,
        allow_agent_file_writes: false,
        allow_network_for_agents: false,
        redact_slack_user_emails: true
      }
    });

    const config = parseConfig(migrated);
    expect(config.config_version).toBe(1);
    expect(config.local_docs).toEqual([]);
    expect(config.tools.providers).toEqual([]);
    expect(config.context.max_evidence_items).toBe(24);
    expect(config.slack.oauth.scopes).toContain("commands");
    expect(config.slack.oauth.user_scopes).toContain("chat:write");
  });

  it("rejects unsafe cloud-backed agents when local-only enforcement is enabled", () => {
    expect(() =>
      parseConfig({
        profile: { slack_user_id: "UME", timezone: "Asia/Kolkata" },
        slack: { draft_surface: "dm", post_mode: "manual_only", max_drafts_per_hour: 20 },
        triggers: {
          bot_mentions: { enabled: true },
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
          channel_history_before_message: 20,
          max_slack_context_chars: 12000,
          store_slack_context_ttl_hours: 24
        },
        repositories: [],
        agents: {
          default: "cloud-agent",
          available: [{ id: "cloud-agent", command: ["cloud"], local_only: false, timeout_seconds: 90 }]
        },
        focus: {
          enabled: true,
          attention_budget: { max_interruptions_per_hour: 3, batch_low_priority_every_minutes: 60 },
          priority_model: {}
        },
        security: {
          require_approval_before_posting: true,
          allow_agent_file_writes: false,
          allow_network_for_agents: false,
          redact_slack_user_emails: true
        }
      })
    ).toThrow(/local_only/);
  });
});
