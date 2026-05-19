# Using SignalDesk

This guide gets SignalDesk running locally, connects it to Slack, indexes Anchor context, and walks through the draft approval flow.

## Prerequisites

- Node.js 24+
- npm
- A Slack workspace where you can install an app
- `anchor` if you want PR-history context
- A local CLI agent command that reads JSON from stdin and writes JSON to stdout

For npm users:

```bash
npm install -g @pratik7368patil/signald
sig init
sig doctor
```

The npm package is scoped as `@pratik7368patil/signald`; the installed command names remain `sig` and `signald`.

For local development from this repo:

```bash
npm install
npm run build
```

## 1. Create the Slack App

Use `slack-app-manifest.yaml` as the Slack app manifest.

The MVP uses:

- Socket Mode
- A bot user
- `app_mention` events
- Interactive buttons and modals
- `chat.postMessage`

Required bot scopes:

- `app_mentions:read`
- `commands`
- `chat:write`
- `users:read`
- `channels:history`
- `reactions:write`

User-token coworker mode asks for user scopes so SignalDesk can read context you can already see and post as you only after approval:

- `channels:history`
- `groups:history`
- `im:history`
- `mpim:history`
- `search:read`
- `chat:write`

Optional personal mention mode also needs message event subscriptions and the matching history scopes for watched surfaces:

- `groups:history`
- `mpim:history`
- `im:history`

After installing the Slack app, create an app-level token with Socket Mode enabled.

SignalDesk uses `reactions:write` to add an `:eyes:` reaction to accepted mention messages. That reaction is only an acknowledgement; public replies still require clicking `Post`.

First-time map of the Slack values you need:

| `.env` value | Slack dashboard location |
| --- | --- |
| `SLACK_CLIENT_ID` | `Basic Information` -> `App Credentials` -> `Client ID` |
| `SLACK_CLIENT_SECRET` | `Basic Information` -> `App Credentials` -> `Client Secret` |
| `SLACK_APP_TOKEN` | `Basic Information` -> `App-Level Tokens` -> generate a token with `connections:write` |

Do not open the local callback URL directly. Run `sig slack login`; Slack will redirect to the callback URL after you approve the app. See [Slack OAuth Login](slack-oauth.md) for the click-by-click first-time setup.

## 2. Configure Environment

```bash
cp .env.example .env
```

Set:

```bash
SLACK_APP_TOKEN=xapp-...
SLACK_CLIENT_ID=123456789.123456789
SLACK_CLIENT_SECRET=...
SIGNALD_CONFIG=assistant.config.yaml
SIGNALD_DB_PATH=.signald.sqlite
```

`SLACK_BOT_TOKEN` and `SLACK_USER_TOKEN` are optional fallbacks. Prefer `sig slack login`, which stores bot and user tokens locally after OAuth without printing them.

## 3. Configure SignalDesk

Start from the wizard:

```bash
sig init
```

Or start from the example:

```bash
cp assistant.config.example.yaml assistant.config.yaml
```

Minimum fields to edit:

```yaml
profile:
  slack_user_id: "U1234567890"
  timezone: "Asia/Kolkata"

repositories:
  - id: payments
    path: "~/code/payments-service"
    github_repo: "your-org/payments-service"
    channels: ["C012PAYMENTS"]

agents:
  default: local-agent
  available:
    - id: local-agent
      command: ["local-llm", "chat", "--json"]
      local_only: true
      timeout_seconds: 90
```

### Using Codex or Claude Code as the draft agent

The default `local-agent` example is a placeholder. If `sig doctor` says `local-llm not found`, configure an installed CLI agent instead.

Codex and Claude Code are usually cloud-backed CLIs, not local-only model runtimes. To use them, explicitly allow network-backed agents:

```yaml
security:
  require_approval_before_posting: true
  allow_agent_file_writes: false
  allow_network_for_agents: true
  redact_slack_user_emails: true
```

Codex example:

```yaml
agents:
  default: codex
  available:
    - id: codex
      command:
        - "codex"
        - "exec"
        - "--skip-git-repo-check"
        - "--ephemeral"
        - "--sandbox"
        - "read-only"
        - "--color"
        - "never"
        - "-"
      local_only: false
      timeout_seconds: 180
```

Claude Code example:

```yaml
agents:
  default: claude
  available:
    - id: claude
      command:
        - "claude"
        - "-p"
        - "--output-format"
        - "text"
        - "--permission-mode"
        - "dontAsk"
        - "--tools"
        - ""
        - "--no-session-persistence"
      local_only: false
      timeout_seconds: 180
```

If `claude` is installed by the desktop app but not on `PATH`, either add it to `PATH` or use the absolute binary path in `command[0]`.

Validate:

```bash
sig config validate
sig doctor
```

In development before installing the package globally:

```bash
node dist/cli/sig.js config validate
```

## 4. Login to Slack

Add this redirect URL to your Slack app's OAuth settings:

```text
http://127.0.0.1:31337/slack/oauth/callback
```

Then run:

```bash
sig slack login
sig slack status
```

OAuth returns bot/user installation data and SignalDesk stores it through the local credential store. On macOS it tries Keychain first and also keeps a `0600` local fallback. Socket Mode still requires `SLACK_APP_TOKEN`; Slack OAuth does not return app-level tokens.

## 5. Configure Anchor

Install Anchor:

```bash
npm install -g @pratik7368patil/anchor
```

Authenticate GitHub:

```bash
gh auth login
```

First-time repository setup:

```bash
sig github setup ~/code
```

For an organization:

```bash
sig github setup ~/code --owner your-org
```

The terminal picker lists repositories from `gh repo list`, marks local matches under `~/code`, and lets you select by number or range:

```text
Repos to add: 1,3-5
```

Type `a` to add a repo that is not shown. If the selected repo is not local yet, SignalDesk can clone it with `gh repo clone`, add it to `assistant.config.yaml`, and run Anchor indexing automatically. Use `--no-index` if you want to add repos without indexing, or `--yes` to clone missing selected repos into the default path without extra prompts.

SignalDesk uses your existing local GitHub CLI authentication. During auto-indexing it can read `gh auth token` and pass that token only to the Anchor subprocess as `GH_TOKEN`; it does not store or print the token.

Manual indexing from inside a repository still works:

```bash
cd ~/code/payments-service
anchor index --repo your-org/payments-service --limit 200
```

Or let SignalDesk run indexing for configured repos:

```bash
sig repos index
sig repos sync
```

Check status:

```bash
sig anchor status payments
```

Repository commands:

```bash
sig github setup ~/code
sig repos discover ~/code
sig repos add ~/code/payments-service --github your-org/payments-service --id payments
sig repos map-channel payments C012PAYMENTS
sig repos list
```

## 6. Add Local Docs

Local docs are the first-class "company context" source for v1. Add runbooks, design docs, onboarding notes, incident docs, or team conventions:

```bash
sig docs add ~/company/runbooks --repo payments --id runbooks
sig docs index
sig docs list
```

Docs are indexed locally into SQLite FTS. Secret-looking paths such as `.env*`, `*.pem`, and `*secret*` are excluded by default.

## 7. Provide a Local Agent

The configured agent must read JSON from stdin and return JSON only:

```json
{
  "draft": "I can take a look. I need the failing request id to be precise.",
  "confidence": 0.74,
  "assumptions": ["No request id was included."],
  "sources": ["Slack thread", "Anchor PR history"],
  "needs_human_review": true
}
```

A tiny fake local agent for smoke testing:

```bash
mkdir -p .local-bin
cat > .local-bin/local-llm <<'SH'
#!/usr/bin/env bash
node -e '
let input = "";
process.stdin.on("data", c => input += c);
process.stdin.on("end", () => {
  console.log(JSON.stringify({
    draft: "I can help. Based on the gathered context, I would first confirm the missing details before committing to a fix.",
    confidence: 0.55,
    assumptions: ["Smoke-test agent response."],
    sources: ["SignalDesk prompt"],
    needs_human_review: true
  }));
});
'
SH
chmod +x .local-bin/local-llm
```

Then configure:

```yaml
agents:
  default: local-agent
  available:
    - id: local-agent
      command: [".local-bin/local-llm"]
      local_only: true
      timeout_seconds: 10
```

## 8. Run the Daemon

Foreground:

```bash
sig dev
```

Background:

```bash
sig start
sig status
sig service logs
sig stop
```

Slack's presence dot is not the source of truth for local Socket Mode health. Use `sig status` and `sig service logs`; mentioning SignalDesk only works while the local `signald` process is running.

OS service helpers:

```bash
sig service install
sig service start
sig service logs
```

You do not need to deploy SignalDesk anywhere for v1. The Slack app configuration lives in Slack, but `signald` runs on your machine and connects through Socket Mode.

## 9. Use It in Slack

Common flows:

- Mention the bot: `@SignalDesk can you draft a reply here?`
- Use the message shortcut: `Draft with SignalDesk`.
- DM SignalDesk: `watch this thread` or `help me reply`.
- Optional personal mention watcher: enable `triggers.personal_mentions.enabled` to draft when someone mentions `<@YOUR_USER_ID>`.

The public `@SignalDesk ...` mention is visible to everyone in that channel because it is a normal Slack message. The draft reply is private in your DM. Nothing is posted back to the thread until you click `Post as Me`.

If personal mention watching is disabled, SignalDesk does not draft when people mention you. If enabled, it only watches the channels allowed by config and still sends private drafts.

## Common Commands

```bash
npm test
npm run typecheck
npm run lint
npm run build
sig init
sig doctor
sig config validate
sig slack login
sig slack status
sig repos discover ~/code
sig repos add ~/code/payments-service --github your-org/payments-service
sig repos index
sig docs add ~/company/runbooks --repo payments
sig docs index
sig anchor status
sig tools add-mcp docs --command "docs-mcp serve" --tool docs_search
sig tools test docs
sig audit
```

## Troubleshooting

No Slack events:

- Confirm Socket Mode is enabled.
- Confirm `SLACK_APP_TOKEN` starts with `xapp-`.
- Run `sig slack status` to confirm OAuth tokens are stored.
- Reinstall the Slack app after changing scopes.

No draft:

- Check whether the event was ignored as bot/self/duplicate.
- Check `assistant.config.yaml` trigger settings.
- Confirm `app_mention` is enabled.

Anchor unavailable:

- Run `anchor --help`.
- Run `anchor index` in the repo.
- Confirm `.anchor/index.sqlite` exists in the repo.
- Run `sig anchor status <repoId>`.

Agent failed:

- Run the agent command manually.
- Confirm it accepts JSON on stdin.
- Confirm it returns valid JSON only.
