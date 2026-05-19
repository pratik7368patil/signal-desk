# SignalDesk

SignalDesk is a local-first Slack coworker assistant. The Slack app lives in Slack, but the backend runs on your machine as `signald`. It listens over Bolt JS Socket Mode, gathers Slack and repo context, asks local context tools like `anchor`, runs a configured CLI agent, and sends you a private DM draft.

SignalDesk never posts a public Slack reply automatically. The only public post path is the explicit `Post as Me` button on a private draft.

For npm users:

```bash
npm install -g @pratik7368patil/signald
sig init
sig doctor
```

The npm package is scoped as `@pratik7368patil/signald`; the installed command names remain `sig` and `signald`.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create Slack tokens and enable Socket Mode using `slack-app-manifest.yaml`.

Required MVP scopes:

- `app_mentions:read`
- `chat:write`
- `users:read`
- `channels:history`

Optional personal mention mode also needs the matching history scopes:

- `groups:history`
- `mpim:history`
- `im:history`

3. Configure environment:

```bash
cp .env.example .env
```

Set `SLACK_APP_TOKEN`, `SLACK_CLIENT_ID`, and `SLACK_CLIENT_SECRET`. Then run `sig slack login` to install the app and store bot/user tokens locally. `SLACK_BOT_TOKEN` and `SLACK_USER_TOKEN` are still supported as optional fallbacks.

4. Configure SignalDesk:

```bash
cp assistant.config.example.yaml assistant.config.yaml
npx tsx src/cli/sig.ts config validate
npx tsx src/cli/sig.ts slack login
```

5. Run locally:

```bash
npm run dev
```

After building, the production commands are:

```bash
npm run build
sig dev
signald
```

## CLI

- `sig init`: create or migrate local config and print setup next steps
- `sig doctor`: check Slack, OAuth, SQLite, Anchor, repos, docs, agent, and daemon health
- `sig dev`: run `signald` in the foreground
- `sig start`: start `signald` in the background
- `sig stop`: stop the background daemon
- `sig status`: show daemon status
- `sig slack login`: install SignalDesk to Slack with OAuth and store the bot token locally
- `sig slack status`: show local Slack installation status
- `sig slack logout`: delete the local Slack installation
- `sig repos discover/add/list/index/sync/map-channel`: configure repositories and Anchor indexes
- `sig docs add/list/index`: configure and index local docs into SQLite FTS
- `sig tools add-mcp/list/test`: configure read-only MCP context tools
- `sig service install/start/stop/logs`: install or inspect local service helpers
- `sig audit`: inspect local audit logs
- `sig index`: compatibility alias for repository Anchor indexing
- `sig anchor status`: show Anchor index health
- `sig mcp list`: compatibility command to list tools from a configured MCP server
- `sig mcp call`: call an allowed read-only MCP tool
- `sig test`: run tests
- `sig config validate`: validate `assistant.config.yaml`
- `sig config migrate`: migrate older configs to `config_version: 1`

## Docs

- [Architecture](docs/architecture.md)
- [Usage Guide](docs/usage.md)
- [Slack OAuth Login](docs/slack-oauth.md)
- [Anchor and MCP Integrations](docs/mcp-integrations.md)

## Anchor

SignalDesk supports [`pratik7368patil/anchor`](https://github.com/pratik7368patil/anchor), which is a local-first MCP server for merged GitHub PR-history context. Anchor does not index source files for SignalDesk; it builds a local `.anchor/index.sqlite` from GitHub pull request history and exposes sanitized evidence through MCP tools.

```bash
npm install -g @pratik7368patil/anchor
gh auth login
cd ~/code/payments-service
anchor index --repo your-org/payments-service --limit 200
```

At draft time SignalDesk starts Anchor with:

```bash
anchor serve
```

Then it calls the read-only MCP tool:

```text
anchor_get_context
```

The returned PR-history evidence is added to the agent prompt as repository context. If `anchor` is missing, the MCP server fails, or `.anchor/index.sqlite` does not exist, SignalDesk still creates a Slack-only draft and records the degraded context in assumptions.

Configure Anchor per repository:

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
      sync_on_index: false
      env_allowlist:
        - HOME
        - PATH
        - GITHUB_TOKEN
        - GH_TOKEN
```

`sig repos index` runs `anchor index` or `anchor sync` from each repository path. It does not pass source include/exclude globs to Anchor because Anchor indexes GitHub PR history, not working-tree source files. Secret-like source patterns are therefore never sent to Anchor as indexing inputs.

Helpful commands:

```bash
sig repos index
sig anchor status payments
```

## MCP Tools

SignalDesk has a small generic MCP client layer in [src/mcp](src/mcp). It is designed for read-only local context tools, so new integrations can be added without coupling them to Slack or draft generation.

Add a server to config:

```yaml
mcp:
  enabled: true
  servers:
    - id: docs
      enabled: true
      command: ["my-local-mcp", "serve"]
      cwd: "~/code/payments-service"
      env_allowlist: ["HOME", "PATH"]
      timeout_seconds: 30
      local_only: true
      read_only: true
      allowed_tools: ["docs_search"]
```

Inspect and call configured tools:

```bash
sig mcp list docs
sig mcp call docs docs_search '{"query":"retry policy"}'
```

The generic registry enforces configured `allowed_tools`, passes only allowlisted environment variables, and treats MCP output as untrusted context evidence.

## Agent Contract

Agents receive JSON on stdin and must return JSON only:

```json
{
  "draft": "...",
  "confidence": 0.0,
  "assumptions": [],
  "sources": [],
  "needs_human_review": true
}
```

SignalDesk passes only a minimal environment allowlist to agents. It does not assume every local CLI is backed by a local model; when `allow_network_for_agents` is false, configured agents must be marked `local_only: true`.

## Slack Behavior

- MVP trigger: `app_mention`
- Optional trigger: personal mentions of `<@USER_ID>` when enabled in config
- Bot and self messages are ignored
- Drafts are sent by DM using `chat.postMessage`
- `Edit`, `Regenerate`, `Post as Me`, `Explain Sources`, and `Dismiss` are interactive
- `Edit` uses a Slack modal
- `Post as Me` sends to the original thread with `channel` and `thread_ts`, using the Slack user token when available
- Event handling does not post to the original channel

## Verification

```bash
npm test
npm run typecheck
npm run lint
```
