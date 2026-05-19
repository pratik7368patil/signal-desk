import type { StoredDraft } from "../types.js";

export const ACTION_IDS = {
  edit: "signald_edit",
  regenerate: "signald_regenerate",
  post: "signald_post",
  dismiss: "signald_dismiss",
  explainSources: "signald_explain_sources"
} as const;

export const VIEW_IDS = {
  editDraft: "signald_edit_draft"
} as const;

export const SHORTCUT_IDS = {
  draftWithSignalDesk: "signald_draft_with_signald"
} as const;

export function buildDraftFallbackText(draft: StoredDraft): string {
  return `SignalDesk draft (${draft.priority}) for ${draft.channel}: ${draft.draft}`;
}

export function buildDraftBlocks(draft: StoredDraft): Array<Record<string, unknown>> {
  const repos = draft.selectedRepos.length > 0 ? draft.selectedRepos.join(", ") : "none";
  const assumptions = draft.assumptions.length > 0 ? draft.assumptions.map((item) => `• ${item}`).join("\n") : "None";
  const sources = draft.sources.length > 0 ? draft.sources.map((item) => `• ${item}`).join("\n") : "Slack context only";
  const original = draft.promptJson ? extractPermalink(draft.promptJson) : undefined;
  const contextSummary = draft.promptJson ? extractContextSummary(draft.promptJson) : "Slack context was gathered locally.";
  const contextSources = draft.promptJson ? extractContextSources(draft.promptJson) : sources;

  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `SignalDesk draft: ${draft.priority.toUpperCase()}`
      }
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Repos:*\n${escapeMrkdwn(repos)}`
        },
        {
          type: "mrkdwn",
          text: `*Agent:*\n${escapeMrkdwn(draft.selectedAgent)}`
        }
      ]
    },
    ...(original
      ? [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Original:* <${original}|Open Slack thread>`
            }
          }
        ]
      : []),
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Context summary*\n${escapeMrkdwn(truncateForSlack(contextSummary, 1200))}`
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Draft reply*\n${escapeMrkdwn(truncateForSlack(draft.draft, 2900))}`
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Assumptions*\n${escapeMrkdwn(truncateForSlack(assumptions, 1400))}`
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Sources*\n${escapeMrkdwn(truncateForSlack(contextSources || sources, 1400))}`
      }
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Edit" },
          action_id: ACTION_IDS.edit,
          value: draft.id
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Regenerate" },
          action_id: ACTION_IDS.regenerate,
          value: draft.id
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Post as Me" },
          style: "primary",
          action_id: ACTION_IDS.post,
          value: draft.id,
          confirm: {
            title: { type: "plain_text", text: "Post reply?" },
            text: { type: "mrkdwn", text: "SignalDesk will post this draft to the original Slack thread after this approval." },
            confirm: { type: "plain_text", text: "Post as Me" },
            deny: { type: "plain_text", text: "Cancel" }
          }
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Explain Sources" },
          action_id: ACTION_IDS.explainSources,
          value: draft.id
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Dismiss" },
          style: "danger",
          action_id: ACTION_IDS.dismiss,
          value: draft.id
        }
      ]
    }
  ];
}

export function buildEditModal(draft: StoredDraft): Record<string, unknown> {
  return {
    type: "modal",
    callback_id: VIEW_IDS.editDraft,
    private_metadata: draft.id,
    title: {
      type: "plain_text",
      text: "Edit Draft"
    },
    submit: {
      type: "plain_text",
      text: "Save"
    },
    close: {
      type: "plain_text",
      text: "Cancel"
    },
    blocks: [
      {
        type: "input",
        block_id: "draft",
        label: {
          type: "plain_text",
          text: "Reply"
        },
        element: {
          type: "plain_text_input",
          action_id: "text",
          multiline: true,
          initial_value: draft.draft
        }
      }
    ]
  };
}

function extractPermalink(promptJson: string): string | undefined {
  try {
    const prompt = JSON.parse(promptJson) as { slack_context?: { permalink?: unknown } };
    return typeof prompt.slack_context?.permalink === "string" ? prompt.slack_context.permalink : undefined;
  } catch {
    return undefined;
  }
}

function extractContextSummary(promptJson: string): string {
  try {
    const prompt = JSON.parse(promptJson) as {
      slack_context?: {
        originalText?: unknown;
        messages?: Array<{ user?: string; text?: string }>;
        truncated?: unknown;
      };
      priority?: { priority?: unknown; reasons?: unknown };
    };
    const original =
      typeof prompt.slack_context?.originalText === "string" && prompt.slack_context.originalText.trim()
        ? prompt.slack_context.originalText.trim()
        : undefined;
    const messages = Array.isArray(prompt.slack_context?.messages) ? prompt.slack_context.messages : [];
    const lines = messages
      .slice(0, 4)
      .map((message) => {
        const text = typeof message.text === "string" ? message.text.trim() : "";
        const user = typeof message.user === "string" ? `<@${message.user}>` : "Someone";
        return text ? `• ${user}: ${text}` : undefined;
      })
      .filter((line): line is string => line !== undefined);
    const priority =
      typeof prompt.priority?.priority === "string"
        ? `Priority: ${prompt.priority.priority}${
            Array.isArray(prompt.priority.reasons) ? ` (${prompt.priority.reasons.join(", ")})` : ""
          }`
        : undefined;
    return [priority, original ? `Original: ${original}` : undefined, ...lines, prompt.slack_context?.truncated ? "Slack context was truncated." : undefined]
      .filter((line): line is string => line !== undefined)
      .join("\n");
  } catch {
    return "Slack context was gathered locally.";
  }
}

function extractContextSources(promptJson: string): string {
  try {
    const prompt = JSON.parse(promptJson) as {
      context_bundle?: {
        citations?: Array<{ label?: unknown; uri?: unknown; providerId?: unknown; sourceType?: unknown }>;
        evidence?: Array<{ title?: unknown; sourceType?: unknown; repoId?: unknown }>;
      };
    };
    const citations = Array.isArray(prompt.context_bundle?.citations) ? prompt.context_bundle.citations : [];
    if (citations.length > 0) {
      return citations
        .slice(0, 10)
        .map((citation) => {
          const label = typeof citation.label === "string" ? citation.label : "source";
          const sourceType = typeof citation.sourceType === "string" ? citation.sourceType : "context";
          const uri = typeof citation.uri === "string" ? ` (${citation.uri})` : "";
          return `• ${sourceType}: ${label}${uri}`;
        })
        .join("\n");
    }
    const evidence = Array.isArray(prompt.context_bundle?.evidence) ? prompt.context_bundle.evidence : [];
    return evidence
      .slice(0, 10)
      .map((item) => {
        const title = typeof item.title === "string" ? item.title : "context";
        const sourceType = typeof item.sourceType === "string" ? item.sourceType : "context";
        const repo = typeof item.repoId === "string" ? ` [${item.repoId}]` : "";
        return `• ${sourceType}${repo}: ${title}`;
      })
      .join("\n");
  } catch {
    return "";
  }
}

function truncateForSlack(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 16)}\n[truncated]`;
}

function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
