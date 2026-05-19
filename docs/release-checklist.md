# SignalDesk Release Checklist

Use this before publishing the `signald` npm package.

## Preflight

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm run pack:smoke
```

## GitHub Actions Publishing

The repository includes `.github/workflows/publish-npm.yml`.

Publishing runs when a GitHub release is published or when the workflow is dispatched manually. It supports npm Trusted Publishing through OIDC (`id-token: write`) and also supports a fallback `NPM_TOKEN` repository/environment secret.

Before the first automated publish, configure one of:

- npm Trusted Publisher for `pratik7368patil/signal-desk`, workflow `publish-npm.yml`, environment `npm`.
- GitHub environment/repository secret `NPM_TOKEN` with publish access to the `signald` package.

## NPM Smoke Test

```bash
TARBALL="$(npm pack --silent)"
TMPDIR="$(mktemp -d)"
cd "$TMPDIR"
npm init -y
npm install "/path/to/signal-desk/$TARBALL"
npx sig --help
npx sig init --dry-run
npx sig config validate /path/to/signal-desk/assistant.config.example.yaml
```

## Manual Runtime Check

1. Create or update the Slack app from `slack-app-manifest.yaml`.
2. Set `SLACK_APP_TOKEN`, `SLACK_CLIENT_ID`, and `SLACK_CLIENT_SECRET`.
3. Run `sig slack login`.
4. Run `sig doctor`.
5. Run `sig dev`.
6. Mention `@SignalDesk` in Slack and confirm only a private DM draft is sent.
7. Click `Post as Me` and confirm the reply is posted to the original thread.

## Security Check

- Tokens are not printed in CLI output.
- Credential fallback file is `0600`.
- `npm install -g signald` has no postinstall side effects.
- Agents and MCP tools receive allowlisted/minimal env only.
- Prompt injection text from Slack/docs/repos is evidence, not instructions.
- Public posting only happens through the explicit Slack action path.
