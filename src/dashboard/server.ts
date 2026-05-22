import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AssistantConfig } from "../config/schema.js";
import { AttentionRepo } from "../storage/attentionRepo.js";
import { AuditRepo } from "../storage/auditRepo.js";
import { DraftsRepo } from "../storage/draftsRepo.js";
import type { SignalDeskDb } from "../storage/sqlite.js";
import { WatchRepo } from "../storage/watchRepo.js";
import { parseSlackThreadLink } from "../core/watchThreads.js";

export interface DashboardStatus {
  daemon: "running" | "stopped" | "unknown";
  slack: {
    socketMode: boolean;
    appTokenConfigured: boolean;
    botTokenAvailable: boolean;
    userTokenAvailable: boolean;
    missingBotScopes: string[];
    missingUserScopes: string[];
  };
}

export interface CreateDashboardServerOptions {
  config: AssistantConfig;
  db: SignalDeskDb;
  status?: DashboardStatus;
}

export function createDashboardServer(options: CreateDashboardServerOptions): Server {
  const attentionRepo = new AttentionRepo(options.db);
  const draftsRepo = new DraftsRepo(options.db);
  const auditRepo = new AuditRepo(options.db);
  const watchRepo = new WatchRepo(options.db);

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${options.config.dashboard.host}:${options.config.dashboard.port}`);
      if (req.method === "GET" && url.pathname === "/") {
        respondHtml(res, dashboardHtml());
        return;
      }
      if (req.method === "GET" && url.pathname === options.config.slack.oauth.redirect_path) {
        respondHtml(
          res,
          messageHtml(
            "SignalDesk Slack login",
            "This callback is used during `sig slack login`. If you opened it directly, return to the terminal and run `sig slack login`."
          )
        );
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/status") {
        respondJson(res, {
          config: publicConfigSummary(options.config),
          status: options.status ?? defaultStatus()
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/inbox") {
        respondJson(res, { items: attentionRepo.list({ limit: Number(url.searchParams.get("limit") ?? 50) }) });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/drafts") {
        respondJson(res, { drafts: draftsRepo.list({ limit: Number(url.searchParams.get("limit") ?? 50) }) });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/audit") {
        respondJson(res, { audit: auditRepo.list().slice(-Number(url.searchParams.get("limit") ?? 50)).reverse() });
        return;
      }
      if (req.method === "POST" && url.pathname.match(/^\/api\/inbox\/[^/]+\/dismiss$/)) {
        attentionRepo.dismiss(decodeURIComponent(url.pathname.split("/")[3] ?? ""));
        respondJson(res, { ok: true });
        return;
      }
      if (req.method === "POST" && url.pathname.match(/^\/api\/inbox\/[^/]+\/snooze$/)) {
        const body = await readJson(req);
        const until = typeof body.until === "string" ? body.until : new Date(Date.now() + 60 * 60_000).toISOString();
        attentionRepo.snooze(decodeURIComponent(url.pathname.split("/")[3] ?? ""), until);
        respondJson(res, { ok: true });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/watch") {
        const body = await readJson(req);
        const link = typeof body.link === "string" ? parseSlackThreadLink(body.link) : undefined;
        if (!link) {
          respondJson(res, { ok: false, error: "invalid_slack_thread_link" }, 400);
          return;
        }
        const watched = watchRepo.watch({
          channel: link.channel,
          threadTs: link.threadTs,
          ...(typeof body.link === "string" ? { permalink: body.link } : {}),
          reason: typeof body.reason === "string" ? body.reason : "dashboard"
        });
        respondJson(res, { ok: true, watched });
        return;
      }
      if (req.method === "POST" && url.pathname.match(/^\/api\/watch\/[^/]+\/stop$/)) {
        watchRepo.stop(decodeURIComponent(url.pathname.split("/")[3] ?? ""));
        respondJson(res, { ok: true });
        return;
      }
      respondJson(res, { ok: false, error: "not_found" }, 404);
    } catch (error) {
      respondJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });
}

export function startDashboardServer(options: CreateDashboardServerOptions): Server | undefined {
  if (!options.config.dashboard.enabled) {
    return undefined;
  }
  const server = createDashboardServer(options);
  server.listen(options.config.dashboard.port, options.config.dashboard.host);
  return server;
}

function publicConfigSummary(config: AssistantConfig): Record<string, unknown> {
  return {
    config_version: config.config_version,
    profile: {
      slack_user_id: config.profile.slack_user_id,
      timezone: config.profile.timezone,
      role: config.profile.role,
      teams: config.profile.teams,
      owned_systems: config.profile.owned_systems,
      writing_style: {
        preferred_format: config.profile.writing_style.preferred_format,
        notes_count: config.profile.writing_style.notes.length,
        examples_count: config.profile.writing_style.examples.length
      }
    },
    dashboard: config.dashboard,
    repositories: config.repositories.map((repo) => ({
      id: repo.id,
      path: repo.path,
      github_repo: repo.github_repo,
      channels: repo.channels,
      anchor_enabled: repo.anchor.enabled
    })),
    local_docs: config.local_docs.map((source) => ({ id: source.id, path: source.path, repo_id: source.repo_id })),
    inbox: config.inbox,
    watch: config.watch
  };
}

function defaultStatus(): DashboardStatus {
  return {
    daemon: "running",
    slack: {
      socketMode: Boolean(process.env.SLACK_APP_TOKEN),
      appTokenConfigured: Boolean(process.env.SLACK_APP_TOKEN),
      botTokenAvailable: Boolean(process.env.SLACK_BOT_TOKEN),
      userTokenAvailable: Boolean(process.env.SLACK_USER_TOKEN),
      missingBotScopes: [],
      missingUserScopes: []
    }
  };
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function respondJson(res: ServerResponse, body: unknown, statusCode = 200): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function respondHtml(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"
  });
  res.end(body);
}

function messageHtml(title: string, message: string): string {
  return `<!doctype html><html><head><title>${escapeHtml(title)}</title>${styleTag()}</head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}

function dashboardHtml(): string {
  return `<!doctype html>
<html>
<head>
  <title>SignalDesk</title>
  ${styleTag()}
</head>
<body>
  <main>
    <section class="hero">
      <div>
        <p class="eyebrow">Local personal coworker assistant</p>
        <h1>SignalDesk</h1>
        <p class="lead">Private Slack drafts, attention triage, watched threads, and local work context.</p>
      </div>
      <div class="status-pill" id="daemon">Loading...</div>
    </section>
    <nav>
      <button data-tab="setup">Setup</button>
      <button data-tab="status">Status</button>
      <button data-tab="inbox">Inbox</button>
      <button data-tab="drafts">Drafts</button>
      <button data-tab="audit">Audit</button>
    </nav>
    <section id="content"></section>
  </main>
  <script>
const content = document.getElementById("content");
const daemon = document.getElementById("daemon");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
async function getJson(path) {
  const response = await fetch(path);
  return response.json();
}
function command(text) {
  return '<code>' + escapeHtml(text) + '</code>';
}
async function renderSetup() {
  const data = await getJson("/api/status");
  daemon.textContent = data.status.daemon;
  content.innerHTML = '<h2>Setup</h2><div class="grid">' +
    card('1. Install', command('npm install -g @pratik7368patil/signald') + command('sig init --yes')) +
    card('2. Slack app', '<p>Create the Slack app from <strong>slack-app-manifest.yaml</strong>, enable Socket Mode, then run:</p>' + command('sig slack login')) +
    card('3. Context', command('sig github setup ~/code') + command('sig docs add <path> && sig docs index')) +
    card('4. Verify', command('sig doctor') + command('sig start')) +
  '</div>';
}
function card(title, body) {
  return '<article><h3>' + escapeHtml(title) + '</h3>' + body + '</article>';
}
async function renderStatus() {
  const data = await getJson("/api/status");
  daemon.textContent = data.status.daemon;
  content.innerHTML = '<h2>Status</h2><pre>' + escapeHtml(JSON.stringify(data, null, 2)) + '</pre>';
}
async function renderInbox() {
  const data = await getJson("/api/inbox");
  content.innerHTML = '<h2>Inbox</h2>' + list(data.items, (item) => '<strong>' + escapeHtml(item.priority.toUpperCase()) + '</strong> ' + escapeHtml(item.title) + '<p>' + escapeHtml(item.summary) + '</p><small>' + escapeHtml(item.state) + ' · ' + escapeHtml(item.category) + '</small>');
}
async function renderDrafts() {
  const data = await getJson("/api/drafts");
  content.innerHTML = '<h2>Drafts</h2>' + list(data.drafts, (draft) => '<strong>' + escapeHtml(draft.status) + '</strong> ' + escapeHtml(draft.priority) + '<p>' + escapeHtml(draft.draft) + '</p><small>confidence ' + escapeHtml(draft.confidence) + '</small>');
}
async function renderAudit() {
  const data = await getJson("/api/audit");
  content.innerHTML = '<h2>Audit</h2>' + list(data.audit, (row) => '<strong>' + escapeHtml(row.action) + '</strong><p>' + escapeHtml(JSON.stringify(row.details)) + '</p><small>' + escapeHtml(row.createdAt) + '</small>');
}
function list(items, render) {
  if (!items || items.length === 0) return '<p class="empty">Nothing here yet.</p>';
  return '<div class="list">' + items.map((item) => '<article>' + render(item) + '</article>').join('') + '</div>';
}
const tabs = { setup: renderSetup, status: renderStatus, inbox: renderInbox, drafts: renderDrafts, audit: renderAudit };
document.querySelectorAll('button[data-tab]').forEach((button) => button.addEventListener('click', () => tabs[button.dataset.tab]()));
renderSetup();
  </script>
</body>
</html>`;
}

function styleTag(): string {
  return `<style>
body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f7f7f4;color:#202124}
main{max-width:1120px;margin:0 auto;padding:32px 20px}
.hero{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;border-bottom:1px solid #d9d9d0;padding-bottom:20px}
.eyebrow{font-size:13px;text-transform:uppercase;color:#666;margin:0 0 8px}
h1{font-size:44px;line-height:1;margin:0 0 10px;letter-spacing:0}
.lead{font-size:18px;margin:0;color:#444;max-width:680px}
.status-pill{border:1px solid #c9c9c0;background:#fff;padding:8px 12px;border-radius:6px;font-size:14px}
nav{display:flex;gap:8px;flex-wrap:wrap;margin:22px 0}
button{border:1px solid #b7b7ad;background:#fff;border-radius:6px;padding:8px 12px;font:inherit;cursor:pointer}
button:hover{background:#ecece6}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
article{background:#fff;border:1px solid #deded5;border-radius:8px;padding:14px}
h2{font-size:24px;margin:0 0 14px}h3{font-size:16px;margin:0 0 10px}
code{display:block;background:#1f2937;color:#f9fafb;padding:9px;border-radius:6px;margin:8px 0;overflow:auto}
pre{background:#fff;border:1px solid #deded5;border-radius:8px;padding:14px;overflow:auto}
.list{display:grid;gap:10px}.empty{color:#666}
small{color:#666}
  </style>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
