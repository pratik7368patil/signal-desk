import { McpToolRegistry } from "../mcp/toolRegistry.js";
import { readMutableConfig, writeMutableConfig } from "./configOps.js";

export function addMcpToolServer(
  configPath: string,
  input: { id: string; command: string[]; tools?: string[]; cwd?: string }
): void {
  const config = readMutableConfig(configPath);
  if (config.mcp.servers.some((server) => server.id === input.id)) {
    throw new Error(`MCP server ${input.id} already exists`);
  }
  writeMutableConfig(configPath, {
    ...config,
    mcp: {
      ...config.mcp,
      servers: [
        ...config.mcp.servers,
        {
          id: input.id,
          enabled: true,
          command: input.command,
          ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
          env_allowlist: ["HOME", "PATH", "LANG", "LC_ALL", "TZ", "TMPDIR"],
          timeout_seconds: 30,
          local_only: true,
          read_only: true,
          allowed_tools: input.tools ?? []
        }
      ]
    },
    tools: {
      providers: [
        ...config.tools.providers,
        {
          id: input.id,
          type: "mcp",
          enabled: true,
          mcp_server_id: input.id,
          description: "Read-only MCP context provider",
          auth_required: [],
          read_only: true
        }
      ]
    }
  });
}

export async function testMcpToolServer(configPath: string, serverId: string): Promise<string[]> {
  const config = readMutableConfig(configPath);
  return new McpToolRegistry(config).listTools(serverId);
}

export function parseCommand(value: string): string[] {
  return value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}
