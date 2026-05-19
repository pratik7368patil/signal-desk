import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

export const pidPath = resolve(".signald.pid");

export function readPid(): number | undefined {
  if (!existsSync(pidPath)) {
    return undefined;
  }
  const value = Number(readFileSync(pidPath, "utf8").trim());
  return Number.isInteger(value) ? value : undefined;
}

export function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isRunningFromPidFile(): boolean {
  const pid = readPid();
  return pid !== undefined && processExists(pid);
}

export function removePidFile(): void {
  rmSync(pidPath, { force: true });
}

export function installService(configPath: string, options: { dryRun?: boolean; command?: string; args?: string[] } = {}): string {
  const command = options.command ?? process.execPath;
  const args = options.args ?? [process.argv[1] ?? "signald"];
  const logDir = join(homedir(), ".local", "state", "signald");
  const plistPath = join(homedir(), "Library", "LaunchAgents", "com.signald.plist");
  const systemdPath = join(homedir(), ".config", "systemd", "user", "signald.service");

  if (platform() === "darwin") {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.signald</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(command)}</string>
${args.map((arg) => `    <string>${escapeXml(arg)}</string>`).join("\n")}
    <string>--config</string>
    <string>${escapeXml(resolve(configPath))}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${escapeXml(join(logDir, "signald.out.log"))}</string>
  <key>StandardErrorPath</key><string>${escapeXml(join(logDir, "signald.err.log"))}</string>
</dict>
</plist>
`;
    if (!options.dryRun) {
      mkdirSync(dirname(plistPath), { recursive: true });
      mkdirSync(logDir, { recursive: true });
      writeFileSync(plistPath, plist, { mode: 0o600 });
    }
    return plistPath;
  }

  const service = `[Unit]
Description=SignalDesk local Slack coworker assistant

[Service]
ExecStart=${[command, ...args, "--config", resolve(configPath)].map(shellEscape).join(" ")}
Restart=always
Environment=SIGNALD_CONFIG=${resolve(configPath)}

[Install]
WantedBy=default.target
`;
  if (!options.dryRun) {
    mkdirSync(dirname(systemdPath), { recursive: true });
    mkdirSync(logDir, { recursive: true });
    writeFileSync(systemdPath, service, { mode: 0o600 });
  }
  return systemdPath;
}

export function serviceLogPaths(): string[] {
  const logDir = join(homedir(), ".local", "state", "signald");
  return [join(logDir, "signald.out.log"), join(logDir, "signald.err.log")];
}

export function spawnDetached(command: string, args: string[], env: NodeJS.ProcessEnv): number | undefined {
  const logPaths = serviceLogPaths();
  const stdoutPath = logPaths[0]!;
  const stderrPath = logPaths[1]!;
  mkdirSync(dirname(stdoutPath), { recursive: true });
  const stdout = openSync(stdoutPath, "a");
  const stderr = openSync(stderrPath, "a");
  const child = spawn(command, args, {
    detached: true,
    stdio: ["ignore", stdout, stderr],
    env
  });
  closeSync(stdout);
  closeSync(stderr);
  writeFileSync(pidPath, String(child.pid));
  child.unref();
  return child.pid;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shellEscape(value: string): string {
  if (/^[a-zA-Z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}
