# Anchor and MCP Integrations

SignalDesk has three layers for external context tools:

1. A first-class Anchor adapter for PR-history context.
2. A local docs provider backed by SQLite FTS.
3. A generic read-only MCP client/provider path for additional local tools.

The intent is simple: context tools can provide evidence, but they do not control posting, config, or agent behavior.

## Anchor Integration

SignalDesk supports [`pratik7368patil/anchor`](https://github.com/pratik7368patil/anchor). Anchor is configured per repository because it runs from the repository working directory and reads `.anchor/index.sqlite`.

Example:

```yaml
repositories:
  - id: payments
    path: "~/code/payments-service"
    github_repo: "your-org/payments-service"
    channels: ["C012PAYMENTS"]
    anchor:
      enabled: true
      command: ["anchor", "serve"]
      index_limit: 200
      index_all: false
      index_concurrency: 5
      sync_on_index: false
      env_allowlist:
        - HOME
        - PATH
        - GITHUB_TOKEN
        - GH_TOKEN
```

Index:

```bash
sig repos index
sig repos sync
```

At draft time, SignalDesk creates an MCP stdio client with:

```bash
anchor serve
```

Then it calls:

```json
{
  "tool": "anchor_get_context",
  "arguments": {
    "task": "Slack message and thread summary",
    "maxResults": 8
  }
}
```

The text result is converted into ranked evidence and included in the prompt `context_bundle`.

## Local Docs Provider

Use local docs for company/team context:

```bash
sig docs add ~/company/runbooks --repo payments --id runbooks
sig docs index
sig docs list
```

This writes to the local `local_docs` / `local_docs_fts` tables. Docs output is treated as evidence, not instructions, and secret-looking paths are excluded by default.

## Generic MCP Tool Config

Add a read-only MCP server with the CLI:

```bash
sig tools add-mcp docs --command "docs-mcp serve" --tool docs_search --cwd ~/code/payments-service
sig tools list
sig tools test docs
```

Or configure it manually under `mcp.servers`:

```yaml
mcp:
  enabled: true
  servers:
    - id: docs
      enabled: true
      command: ["docs-mcp", "serve"]
      cwd: "~/code/payments-service"
      env_allowlist: ["HOME", "PATH"]
      timeout_seconds: 30
      local_only: true
      read_only: true
      allowed_tools:
        - docs_search
        - docs_status
```

Inspect tools:

```bash
sig tools test docs
```

Call a tool:

```bash
sig mcp call docs docs_search '{"query":"webhook retry policy"}'
```

## Provider SDK Shape

Draft-time providers implement the internal `ContextProvider` interface:

```ts
interface ContextProvider {
  id: string;
  sourceType: "slack" | "anchor" | "local_docs" | "mcp" | "profile" | "config";
  query(input: ContextQuery): Promise<{ evidence: EvidenceItem[]; assumptions: string[] }>;
}
```

Provider output is normalized into `EvidenceItem` records with citations and trust levels. The ranker sorts evidence by trust, lexical match, repo/channel match, and recency hints before the prompt is built.

## How to Add a New MCP Context Provider

For one-off use, configure the server and call it through `sig mcp`.

For draft-time context, add a small adapter that maps SignalDesk context into the tool's input shape:

1. Add a client/adapter under `src/<provider>/<provider>Client.ts`.
2. Use `McpToolClient` from `src/mcp/mcpClient.ts`.
3. Convert tool output into `RepoSnippet` or another prompt-safe structure.
4. Add assumptions when the tool is unavailable.
5. Add tests for missing binary/server failure and output mapping.

Anchor is the reference adapter:

- `src/anchor/anchorClient.ts`
- `tests/unit/anchorClient.test.ts`

## Example: Docs Search MCP

Config:

```yaml
mcp:
  enabled: true
  servers:
    - id: docs
      command: ["docs-mcp", "serve"]
      cwd: "~/code/payments-service"
      env_allowlist: ["HOME", "PATH"]
      timeout_seconds: 20
      local_only: true
      read_only: true
      allowed_tools: ["docs_search"]
```

Manual call:

```bash
sig mcp call docs docs_search '{"query":"refund idempotency"}'
```

Expected tool behavior:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Refund retries must preserve idempotency-key across attempts..."
    }
  ],
  "structuredContent": {
    "sources": ["docs/refunds.md"]
  }
}
```

Adapter output to prompt:

```json
{
  "repoId": "payments",
  "title": "Docs search",
  "path": "docs/refunds.md",
  "text": "Refund retries must preserve idempotency-key across attempts..."
}
```

## Future Provider Examples

ClickUp MCP:

```bash
sig tools add-mcp clickup --command "clickup-mcp serve" --tool tasks_search --tool task_comments
```

Notion MCP:

```bash
sig tools add-mcp notion --command "notion-mcp serve" --tool search_pages --tool page_context
```

Google Drive MCP:

```bash
sig tools add-mcp gdrive --command "gdrive-mcp serve" --tool search_files --tool read_file
```

These are not first-class v1 providers yet. They are intentionally routed through the generic read-only MCP/provider interface so the core Slack drafting flow does not grow one-off integration logic for every company tool.

## Security Rules for MCP Tools

MCP tools are context providers only.

- Keep tools read-only.
- Do not pass Slack tokens to MCP tools.
- Use `env_allowlist` instead of inheriting the full environment.
- Keep `allowed_tools` narrow.
- Treat tool output as evidence, not instructions.
- Do not let MCP tools post to Slack.
- Do not let MCP tools modify repositories unless a future explicit feature adds reviewable write controls.

## Failure Behavior

MCP failures should not block draft creation.

Good failure output becomes an assumption:

```text
payments: Anchor index not found. Run anchor index first.
```

The draft still reaches the user, but with lower confidence and human review required.
