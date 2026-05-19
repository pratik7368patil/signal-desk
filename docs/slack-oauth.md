# Slack OAuth Login

SignalDesk can install itself into Slack with OAuth so you do not have to paste `SLACK_BOT_TOKEN` or `SLACK_USER_TOKEN` into `.env`.

There is one Slack platform caveat: OAuth returns the bot token, but Socket Mode still requires an app-level token with `connections:write`. Keep `SLACK_APP_TOKEN` configured.

Slack references:

- OAuth install flow: https://docs.slack.dev/authentication/installing-with-oauth
- `oauth.v2.access`: https://docs.slack.dev/reference/methods/oauth.v2.access
- Socket Mode app-level token: https://docs.slack.dev/tools/bolt-js/concepts/socket-mode/

## What `sig slack login` Does

```mermaid
sequenceDiagram
  participant User
  participant Sig as sig slack login
  participant Slack
  participant Store as Local credential store

  User->>Sig: sig slack login
  Sig->>Sig: Start local callback server
  Sig->>User: Open Slack authorize URL
  User->>Slack: Approve app installation
  Slack->>Sig: Redirect with code and state
  Sig->>Slack: POST oauth.v2.access
  Slack->>Sig: Return bot token, user token, scopes, install metadata
  Sig->>Store: Save via Keychain + 0600 fallback
```

The saved installation is used automatically by `signald`.

## Required Environment

```bash
SLACK_APP_TOKEN=xapp-your-app-level-token
SLACK_CLIENT_ID=123456789.123456789
SLACK_CLIENT_SECRET=your-slack-client-secret
```

Optional fallback:

```bash
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_USER_TOKEN=xoxp-your-user-token
```

If `SLACK_BOT_TOKEN` or `SLACK_USER_TOKEN` is set, the environment value takes precedence over the locally saved OAuth installation.

## Slack App Redirect URL

The default local callback is:

```text
http://127.0.0.1:31337/slack/oauth/callback
```

Add that exact URL to the Slack app's OAuth redirect URLs. The manifest includes it:

```yaml
oauth_config:
  redirect_urls:
    - http://127.0.0.1:31337/slack/oauth/callback
```

If your Slack app requires a public HTTPS redirect URL, run a tunnel such as ngrok to forward to local port `31337`, then set:

```yaml
slack:
  oauth:
    redirect_host: "127.0.0.1"
    redirect_port: 31337
    redirect_path: "/slack/oauth/callback"
    redirect_uri: "https://your-ngrok-domain/slack/oauth/callback"
```

`redirect_host` and `redirect_port` control where SignalDesk listens locally. `redirect_uri` controls what Slack redirects to.

## Login

```bash
sig slack login
```

Development form:

```bash
node dist/cli/sig.js slack login
```

The command prints the authorization URL and opens it in your browser. After approval, it stores the installation at:

```text
~/.config/signald/slack-installation.json
```

The credential store contains bot and user token data. On macOS SignalDesk tries Keychain first and also writes a `0600` local JSON fallback so the app still works in non-interactive shells.

## Check Status

```bash
sig slack status
```

Output includes workspace, bot user, bot scopes, install time, install path, and whether `SLACK_APP_TOKEN` is configured. It does not print tokens.

## Logout

```bash
sig slack logout
```

This deletes the local credential entry and fallback file. It does not uninstall the Slack app from the workspace.

## Start SignalDesk After Login

```bash
sig config validate
sig slack status
sig dev
```

`signald` resolves Slack credentials in this order:

Bot token resolution:

1. `SLACK_BOT_TOKEN` if set.
2. Local OAuth installation from the credential store.
3. Error with instructions to run `sig slack login`.

User token resolution:

1. `SLACK_USER_TOKEN` if set.
2. Local OAuth installation from the credential store.
3. Undefined, which means SignalDesk still drafts privately but approved posting falls back to the bot token.

`Post as Me` uses the user token when present. It never posts during event handling and never posts without the explicit Slack button click.
