import type { AssistantConfig, McpServerConfig } from "../config/schema.js";
import { expandHomePath } from "../config/loadConfig.js";
import { McpToolClient, type McpToolCallResult } from "./mcpClient.js";

export class McpToolRegistry {
  private readonly client: McpToolClient;

  constructor(private readonly config: AssistantConfig, client = new McpToolClient()) {
    this.client = client;
  }

  server(id: string): McpServerConfig | undefined {
    const server = this.config.mcp.servers.find((candidate) => candidate.id === id && candidate.enabled);
    if (!server) {
      return undefined;
    }
    return normalizeServer(server);
  }

  async listTools(serverId: string): Promise<string[]> {
    const server = this.server(serverId);
    if (!server) {
      return [];
    }
    return this.client.listTools(server);
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const server = this.server(serverId);
    if (!server) {
      return {
        serverId,
        toolName,
        ok: false,
        isError: true,
        text: `MCP server ${serverId} is not configured or disabled`
      };
    }
    return this.client.callTool(server, toolName, args);
  }
}

function normalizeServer(server: McpServerConfig): McpServerConfig {
  return {
    ...server,
    ...(server.cwd === undefined ? {} : { cwd: expandHomePath(server.cwd) })
  };
}
