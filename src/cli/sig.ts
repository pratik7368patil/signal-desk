#!/usr/bin/env node
import "dotenv/config";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { loadConfig, validateConfigFile } from "../config/loadConfig.js";
import { AnchorClient } from "../anchor/anchorClient.js";
import { indexRepositories } from "../anchor/indexManager.js";
import { startSignalD } from "../index.js";
import { McpToolRegistry } from "../mcp/toolRegistry.js";
import { AuditRepo } from "../storage/auditRepo.js";
import { openDatabase } from "../storage/sqlite.js";
import { addDocsSource, indexDocs } from "./docsOps.js";
import { printDoctor, runDoctor } from "./doctor.js";
import { runInit } from "./initOps.js";
import { addRepo, discoverRepos, mapRepoChannel, syncRepos } from "./repoOps.js";
import {
  installService,
  isRunningFromPidFile,
  processExists,
  readPid,
  removePidFile,
  serviceLogPaths,
  spawnDetached
} from "./serviceOps.js";
import { addMcpToolServer, parseCommand, testMcpToolServer } from "./toolsOps.js";
import { migrateConfigFile } from "./configOps.js";
import {
  deleteSlackInstallation,
  loadSlackInstallation,
  runSlackOAuthLogin,
  slackInstallationPath,
  slackRedirectUri
} from "../slack/oauth.js";

const program = new Command();
program.name("sig").description("SignalDesk local Slack coworker assistant").version("0.1.0");

program
  .command("init")
  .description("Create or update assistant.config.yaml and print setup next steps")
  .option("-c, --config <path>", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .option("--dry-run", "show what would happen without writing files")
  .option("--migrate", "migrate an existing config in place")
  .option("--slack-login", "run Slack OAuth login after config checks")
  .option("--no-open", "when using --slack-login, print the authorization URL without opening a browser")
  .action(async (options: { config: string; dryRun?: boolean; migrate?: boolean; slackLogin?: boolean; open: boolean }) => {
    const result = await runInit(options.config, {
      ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
      ...(options.migrate === undefined ? {} : { migrate: options.migrate })
    });
    for (const message of result.messages) {
      console.log(message);
    }
    if (options.slackLogin && !options.dryRun) {
      const config = await loadConfig(options.config);
      console.log(`Slack redirect URI: ${slackRedirectUri(config)}`);
      const installation = await runSlackOAuthLogin(config, {
        openBrowser: options.open,
        onAuthorizeUrl: (url) => {
          console.log(`Open this URL to install SignalDesk:\n${url}`);
        }
      });
      console.log(`Slack login complete for ${installation.teamName ?? installation.teamId ?? "workspace"}`);
    }
  });

program
  .command("doctor")
  .description("Check Slack, OAuth, SQLite, Anchor, repos, docs, agent, and daemon health")
  .option("-c, --config <path>", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .action(async (options: { config: string }) => {
    const checks = await runDoctor(options.config);
    printDoctor(checks);
    process.exitCode = checks.some((check) => check.level === "fail") ? 1 : 0;
  });

program
  .command("dev")
  .description("Run signald in the foreground")
  .option("-c, --config <path>", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .action(async (options: { config: string }) => {
    await startSignalD(options.config);
  });

program
  .command("start")
  .description("Start signald in the background")
  .option("-c, --config <path>", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .action((options: { config: string }) => {
    if (isRunningFromPidFile()) {
      console.log("signald is already running");
      return;
    }
    const entry = resolveSignaldEntrypoint();
    const pid = spawnDetached(process.execPath, entry.args, serviceEnv(options.config));
    console.log(`signald started with pid ${pid ?? "unknown"}`);
  });

program
  .command("stop")
  .description("Stop a background signald process started by sig")
  .action(() => {
    const pid = readPid();
    if (!pid) {
      console.log("signald is not running");
      return;
    }
    try {
      process.kill(pid, "SIGTERM");
      removePidFile();
      console.log(`signald stopped (${pid})`);
    } catch {
      removePidFile();
      console.log("stale signald pid removed");
    }
  });

program
  .command("status")
  .description("Show signald status")
  .action(() => {
    const pid = readPid();
    if (pid && processExists(pid)) {
      console.log(`signald running (${pid})`);
      return;
    }
    console.log("signald stopped");
  });

program
  .command("index")
  .description("Index configured repositories with anchor")
  .option("-c, --config <path>", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .action(async (options: { config: string }) => {
    const config = await loadConfig(options.config);
    const results = await indexRepositories(config.repositories);
    for (const result of results) {
      console.log(`${result.ok ? "ok" : "failed"} ${result.repoId}: ${result.message}`);
    }
  });

const repos = program.command("repos").description("Repository discovery, mapping, and Anchor indexing");
repos
  .command("discover")
  .description("Discover local git repositories")
  .argument("[root]", "root directory", process.cwd())
  .option("--depth <n>", "maximum search depth", "3")
  .action(async (root: string, options: { depth: string }) => {
    const found = await discoverRepos(root, Number(options.depth));
    for (const repo of found) {
      console.log(`${repo.id}\t${repo.path}${repo.githubRepo ? `\t${repo.githubRepo}` : ""}`);
    }
  });

repos
  .command("add")
  .description("Add a repository to assistant.config.yaml")
  .argument("<path>", "repository path")
  .option("-c, --config <path>", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .option("--id <id>", "repository id")
  .option("--github <ownerRepo>", "GitHub owner/repo")
  .action((pathValue: string, options: { config: string; id?: string; github?: string }) => {
    const repo = addRepo(options.config, {
      path: pathValue,
      ...(options.id === undefined ? {} : { id: options.id }),
      ...(options.github === undefined ? {} : { githubRepo: options.github })
    });
    console.log(`Added repo ${repo.id}: ${repo.path}`);
  });

repos
  .command("list")
  .description("List configured repositories")
  .option("-c, --config <path>", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .action(async (options: { config: string }) => {
    const config = await loadConfig(options.config);
    for (const repo of config.repositories) {
      console.log(`${repo.id}\t${repo.path}\t${repo.github_repo ?? ""}\tchannels=${repo.channels.join(",") || "-"}`);
    }
  });

repos
  .command("index")
  .description("Index configured repositories with Anchor")
  .option("-c, --config <path>", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .action(async (options: { config: string }) => {
    const config = await loadConfig(options.config);
    for (const result of await indexRepositories(config.repositories)) {
      console.log(`${result.ok ? "ok" : "failed"} ${result.repoId}: ${result.message}`);
    }
  });

repos
  .command("sync")
  .description("Incrementally sync configured Anchor PR-history indexes")
  .option("-c, --config <path>", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .action(async (options: { config: string }) => {
    const config = await loadConfig(options.config);
    for (const result of await syncRepos(config)) {
      console.log(`${result.ok ? "ok" : "failed"} ${result.repoId}: ${result.message}`);
    }
  });

repos
  .command("map-channel")
  .description("Associate a Slack channel id with a repository")
  .argument("<repoId>", "repository id")
  .argument("<channel>", "Slack channel id")
  .option("-c, --config <path>", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .action((repoId: string, channel: string, options: { config: string }) => {
    const repo = mapRepoChannel(options.config, repoId, channel);
    console.log(`Mapped ${repo.id} to ${repo.channels.join(", ")}`);
  });

const docs = program.command("docs").description("Local markdown/text docs context");
docs
  .command("add")
  .description("Add a local docs directory")
  .argument("<path>", "docs path")
  .option("-c, --config <path>", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .option("--id <id>", "docs source id")
  .option("--repo <repoId>", "related repository id")
  .action((pathValue: string, options: { config: string; id?: string; repo?: string }) => {
    const source = addDocsSource(options.config, {
      path: pathValue,
      ...(options.id === undefined ? {} : { id: options.id }),
      ...(options.repo === undefined ? {} : { repoId: options.repo })
    });
    console.log(`Added docs ${source.id}: ${source.path}`);
  });

docs
  .command("list")
  .description("List configured local docs sources")
  .option("-c, --config <path>", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .action(async (options: { config: string }) => {
    const config = await loadConfig(options.config);
    for (const source of config.local_docs) {
      console.log(`${source.id}\t${source.path}\trepo=${source.repo_id ?? "-"}`);
    }
  });

docs
  .command("index")
  .description("Index local docs into SQLite FTS")
  .option("-c, --config <path>", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .action(async (options: { config: string }) => {
    for (const result of await indexDocs(options.config)) {
      console.log(`${result.sourceId}: indexed=${result.indexed} skipped=${result.skipped}`);
    }
  });

const tools = program.command("tools").description("Extensible read-only context tools");
tools
  .command("add-mcp")
  .description("Add a read-only local MCP server")
  .argument("<id>", "server id")
  .requiredOption("--command <command>", "command to start the MCP server")
  .option("-c, --config <path>", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .option("--cwd <path>", "server working directory")
  .option("--tool <name...>", "allowed tool names")
  .action((id: string, options: { command: string; config: string; cwd?: string; tool?: string[] }) => {
    addMcpToolServer(options.config, {
      id,
      command: parseCommand(options.command),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.tool === undefined ? {} : { tools: options.tool })
    });
    console.log(`Added MCP tool server ${id}`);
  });

tools
  .command("list")
  .description("List configured tool providers and MCP servers")
  .option("-c, --config <path>", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .action(async (options: { config: string }) => {
    const config = await loadConfig(options.config);
    for (const server of config.mcp.servers) {
      console.log(`mcp:${server.id}\t${server.enabled ? "enabled" : "disabled"}\t${server.command.join(" ")}`);
    }
    for (const provider of config.tools.providers) {
      console.log(`provider:${provider.id}\t${provider.enabled ? "enabled" : "disabled"}\t${provider.type}`);
    }
  });

tools
  .command("test")
  .description("List tools exposed by a configured MCP server")
  .argument("<serverId>", "MCP server id")
  .option("-c, --config <path>", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .action(async (serverId: string, options: { config: string }) => {
    const toolNames = await testMcpToolServer(options.config, serverId);
    for (const toolName of toolNames) {
      console.log(toolName);
    }
  });

const anchor = program.command("anchor").description("Anchor integration helpers");
anchor
  .command("status")
  .description("Show Anchor index status for configured repositories")
  .argument("[repoId]", "repository id")
  .option("-c, --config <path>", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .action(async (repoId: string | undefined, options: { config: string }) => {
    const config = await loadConfig(options.config);
    const repos = repoId ? config.repositories.filter((repo) => repo.id === repoId) : config.repositories;
    const client = new AnchorClient();
    for (const repo of repos) {
      const result = await client.status(repo);
      console.log(`${result.ok ? "ok" : "failed"} ${repo.id}: ${result.message}`);
    }
  });

const mcp = program.command("mcp").description("Generic read-only MCP tool helpers");
mcp
  .command("list")
  .description("List tools exposed by a configured MCP server")
  .argument("<serverId>", "MCP server id from assistant.config.yaml")
  .option("-c, --config <path>", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .action(async (serverId: string, options: { config: string }) => {
    const config = await loadConfig(options.config);
    const registry = new McpToolRegistry(config);
    const tools = await registry.listTools(serverId);
    for (const tool of tools) {
      console.log(tool);
    }
  });

mcp
  .command("call")
  .description("Call an allowed read-only MCP tool with JSON arguments")
  .argument("<serverId>", "MCP server id from assistant.config.yaml")
  .argument("<toolName>", "tool name")
  .argument("[jsonArgs]", "JSON object arguments", "{}")
  .option("-c, --config <path>", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .action(async (serverId: string, toolName: string, jsonArgs: string, options: { config: string }) => {
    const config = await loadConfig(options.config);
    const args = JSON.parse(jsonArgs) as Record<string, unknown>;
    const result = await new McpToolRegistry(config).callTool(serverId, toolName, args);
    console.log(result.text);
    if (!result.ok) {
      process.exitCode = 1;
    }
  });

const slack = program.command("slack").description("Slack login and installation helpers");
slack
  .command("login")
  .description("Install SignalDesk to Slack with OAuth and store the bot token locally")
  .option("-c, --config <path>", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .option("--no-open", "print the authorization URL without opening a browser")
  .action(async (options: { config: string; open: boolean }) => {
    const config = await loadConfig(options.config);
    console.log(`Slack redirect URI: ${slackRedirectUri(config)}`);
    const installation = await runSlackOAuthLogin(config, {
      openBrowser: options.open,
      onAuthorizeUrl: (url) => {
        console.log(`Open this URL to install SignalDesk:\n${url}`);
      }
    });
    console.log(`Slack login complete for ${installation.teamName ?? installation.teamId ?? "workspace"}`);
    console.log(`Installation saved to ${slackInstallationPath(config)}`);
    console.log("Keep SLACK_APP_TOKEN configured for Socket Mode.");
  });

slack
  .command("status")
  .description("Show the locally stored Slack installation")
  .option("-c, --config <path>", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .action(async (options: { config: string }) => {
    const config = await loadConfig(options.config);
    const installation = await loadSlackInstallation(config);
    if (!installation) {
      console.log(`No local Slack installation found at ${slackInstallationPath(config)}`);
      return;
    }
    console.log(`Workspace: ${installation.teamName ?? "unknown"} (${installation.teamId ?? "unknown"})`);
    console.log(`Bot user: ${installation.botUserId ?? "unknown"}`);
    console.log(`Scopes: ${installation.botScopes.join(", ") || "unknown"}`);
    console.log(`Installed at: ${installation.installedAt}`);
    console.log(`Store: ${slackInstallationPath(config)}`);
    console.log(`Socket Mode app token: ${process.env.SLACK_APP_TOKEN ? "configured" : "missing"}`);
  });

slack
  .command("logout")
  .description("Delete the locally stored Slack installation")
  .option("-c, --config <path>", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .action(async (options: { config: string }) => {
    const config = await loadConfig(options.config);
    await deleteSlackInstallation(config);
    console.log(`Deleted local Slack installation at ${slackInstallationPath(config)}`);
  });

program
  .command("test")
  .description("Run the test suite")
  .action(async () => {
    const result = await runNpmScript("test");
    process.exitCode = result;
  });

const config = program.command("config").description("Config helpers");
config
  .command("validate")
  .description("Validate assistant.config.yaml")
  .argument("[path]", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .action(async (pathValue: string) => {
    await validateConfigFile(pathValue);
    console.log(`${pathValue} is valid`);
  });

config
  .command("migrate")
  .description("Migrate assistant.config.yaml to the current config_version")
  .argument("[path]", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .option("--write", "write changes in place")
  .action((pathValue: string, options: { write?: boolean }) => {
    const result = migrateConfigFile(pathValue, options.write === undefined ? {} : { write: options.write });
    if (options.write) {
      console.log(result.changed ? `${pathValue} migrated` : `${pathValue} already current`);
      return;
    }
    process.stdout.write(result.text);
  });

const service = program.command("service").description("Install and inspect a local OS service");
service
  .command("install")
  .description("Install a macOS launchd or Linux systemd user service")
  .option("-c, --config <path>", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .option("--dry-run", "print the target without writing")
  .action((options: { config: string; dryRun?: boolean }) => {
    const entry = resolveSignaldEntrypoint();
    const target = installService(options.config, {
      command: process.execPath,
      args: entry.args,
      ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun })
    });
    console.log(`${options.dryRun ? "Would write" : "Installed"} service file: ${target}`);
  });

service
  .command("start")
  .description("Start signald using the local background runner")
  .option("-c, --config <path>", "config file", process.env.SIGNALD_CONFIG ?? "assistant.config.yaml")
  .action((options: { config: string }) => {
    if (isRunningFromPidFile()) {
      console.log("signald is already running");
      return;
    }
    const entry = resolveSignaldEntrypoint();
    const pid = spawnDetached(process.execPath, entry.args, serviceEnv(options.config));
    console.log(`signald started with pid ${pid ?? "unknown"}`);
  });

service
  .command("stop")
  .description("Stop the local background signald runner")
  .action(() => {
    const pid = readPid();
    if (!pid) {
      console.log("signald is not running");
      return;
    }
    try {
      process.kill(pid, "SIGTERM");
      removePidFile();
      console.log(`signald stopped (${pid})`);
    } catch {
      removePidFile();
      console.log("stale signald pid removed");
    }
  });

service
  .command("logs")
  .description("Print local service log paths or tail existing logs")
  .option("--tail <n>", "number of characters to print from each log", "4000")
  .action((options: { tail: string }) => {
    for (const pathValue of serviceLogPaths()) {
      console.log(`== ${pathValue} ==`);
      if (!existsSync(pathValue)) {
        console.log("log file does not exist yet");
        continue;
      }
      const content = readFileSync(pathValue, "utf8");
      console.log(content.slice(-Number(options.tail)));
    }
  });

program
  .command("audit")
  .description("Inspect local audit logs")
  .option("--json", "print JSON")
  .option("--limit <n>", "maximum rows", "50")
  .action((options: { json?: boolean; limit: string }) => {
    const db = openDatabase();
    try {
      const rows = new AuditRepo(db).list().slice(-Number(options.limit));
      if (options.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      for (const row of rows) {
        console.log(`${row.id}\t${row.createdAt}\t${row.action}\t${row.draftId ?? "-"}\t${JSON.stringify(row.details)}`);
      }
    } finally {
      db.close();
    }
  });

await program.parseAsync(process.argv);

function resolveSignaldEntrypoint(): { args: string[] } {
  const current = fileURLToPath(import.meta.url);
  const compiled = resolve(dirname(current), "signald.js");
  if (existsSync(compiled)) {
    return { args: [compiled] };
  }
  return { args: ["--import", "tsx", "src/cli/signald.ts"] };
}

function runNpmScript(script: string): Promise<number> {
  return new Promise((resolvePromise) => {
    const child = spawn("npm", ["run", script], {
      stdio: "inherit",
      env: process.env
    });
    child.on("close", (code) => resolvePromise(code ?? 1));
    child.on("error", () => resolvePromise(1));
  });
}

function serviceEnv(configPath: string): NodeJS.ProcessEnv {
  return {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    TZ: process.env.TZ,
    TMPDIR: process.env.TMPDIR,
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
    SLACK_USER_TOKEN: process.env.SLACK_USER_TOKEN,
    SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN,
    SIGNALD_CONFIG: configPath,
    SIGNALD_DB_PATH: process.env.SIGNALD_DB_PATH,
    SIGNALD_LOG_LEVEL: process.env.SIGNALD_LOG_LEVEL
  };
}
