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

## First-Time Slack App Setup

You only need to create the Slack app once per workspace. SignalDesk does not need a hosted server; the app configuration lives in Slack and `signald` runs locally on your machine.

1. Open Slack's app dashboard:

```text
https://api.slack.com/apps
```

2. Click `Create New App`, then choose `From an app manifest`.

3. Pick the workspace where you want to use SignalDesk.

4. Choose `YAML`, then paste the contents of `slack-app-manifest.yaml` from this project.

5. Click through Slack's review screens and create the app.

After the app is created, Slack shows the app settings dashboard. Get the three values for `.env` from these places:

| `.env` value | Where to find it in Slack | What it looks like |
| --- | --- | --- |
| `SLACK_CLIENT_ID` | `Basic Information` -> `App Credentials` -> `Client ID` | `123456789.123456789` |
| `SLACK_CLIENT_SECRET` | `Basic Information` -> `App Credentials` -> `Client Secret` | a long secret string |
| `SLACK_APP_TOKEN` | `Basic Information` -> `App-Level Tokens` -> `Generate Token and Scopes` | starts with `xapp-` |

When creating `SLACK_APP_TOKEN`, name it something like `signald-socket-mode`, add the `connections:write` scope, then click `Generate`. This app-level token is only for Socket Mode. It is not the bot token and it is not the user token.

Create a local `.env` file where you will run SignalDesk:

```bash
cat > .env <<'EOF'
SLACK_APP_TOKEN=xapp-your-app-level-token
SLACK_CLIENT_ID=your-client-id
SLACK_CLIENT_SECRET=your-client-secret
SIGNALD_CONFIG=assistant.config.yaml
SIGNALD_DB_PATH=.signald.sqlite
SIGNALD_LOG_LEVEL=info
EOF
```

Then run OAuth:

```bash
sig slack login
```

`sig slack login` opens Slack's install screen. Approve the app, then Slack redirects back to the local callback URL. SignalDesk uses that callback to save the bot/user tokens locally. You do not need to paste `SLACK_BOT_TOKEN` or `SLACK_USER_TOKEN` by hand for the normal setup.

If you are already looking at `http://127.0.0.1:31337/slack/oauth/callback` in a browser and did not get there by clicking through Slack during `sig slack login`, close that tab and start again with `sig slack login`. The callback URL is not a setup page by itself; it only works while the local login server is running and Slack redirects to it with a temporary OAuth code.

After login:

```bash
sig slack status
sig doctor
```

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
