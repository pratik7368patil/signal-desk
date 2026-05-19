import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServerConfig } from "../config/schema.js";
import { allowlistedEnv } from "../utils/shell.js";

export interface McpToolCallResult {
  serverId: string;
  toolName: string;
  ok: boolean;
  text: string;
  structuredContent?: Record<string, unknown>;
  isError: boolean;
}

export class McpToolClient {
  async listTools(serverConfig: McpServerConfig): Promise<string[]> {
    return withMcpClient(serverConfig, async (client) => {
      const result = await client.listTools(undefined, {
        timeout: serverConfig.timeout_seconds * 1_000
      });
      return result.tools.map((tool) => tool.name);
    });
  }

  async callTool(
    serverConfig: McpServerConfig,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<McpToolCallResult> {
    if (!serverConfig.enabled) {
      return {
        serverId: serverConfig.id,
        toolName,
        ok: false,
        text: `MCP server ${serverConfig.id} is disabled`,
        isError: true
      };
    }
    if (serverConfig.allowed_tools.length > 0 && !serverConfig.allowed_tools.includes(toolName)) {
      return {
        serverId: serverConfig.id,
        toolName,
        ok: false,
        text: `Tool ${toolName} is not allowed for MCP server ${serverConfig.id}`,
        isError: true
      };
    }

    try {
      return await withMcpClient(serverConfig, async (client) => {
        const result = (await client.callTool(
          {
            name: toolName,
            arguments: args
          },
          CallToolResultSchema,
          {
            timeout: serverConfig.timeout_seconds * 1_000,
            maxTotalTimeout: serverConfig.timeout_seconds * 1_000
          }
        )) as CallToolResult;
        const structuredContent =
          result.structuredContent && typeof result.structuredContent === "object" && !Array.isArray(result.structuredContent)
            ? (result.structuredContent as Record<string, unknown>)
            : undefined;
        return {
          serverId: serverConfig.id,
          toolName,
          ok: !result.isError,
          text: extractText(result),
          ...(structuredContent === undefined ? {} : { structuredContent }),
          isError: Boolean(result.isError)
        };
      });
    } catch (error) {
      return {
        serverId: serverConfig.id,
        toolName,
        ok: false,
        text: `MCP server ${serverConfig.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        isError: true
      };
    }
  }
}

async function withMcpClient<T>(serverConfig: McpServerConfig, fn: (client: Client) => Promise<T>): Promise<T> {
  const [command, ...args] = serverConfig.command;
  if (!command) {
    throw new Error(`MCP server ${serverConfig.id} has no command`);
  }
  const client = new Client(
    {
      name: "signald",
      version: "0.1.0"
    },
    {
      capabilities: {}
    }
  );
  const transport = new StdioClientTransport({
    command,
    args,
    env: buildMcpEnv(serverConfig.env_allowlist),
    ...(serverConfig.cwd === undefined ? {} : { cwd: serverConfig.cwd }),
    stderr: "ignore"
  });
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export function buildMcpEnv(envAllowlist: string[]): Record<string, string> {
  return allowlistedEnv(envAllowlist) as Record<string, string>;
}

function extractText(result: CallToolResult): string {
  return result.content
    .map((item) => {
      if (item.type === "text") {
        return item.text;
      }
      if (item.type === "resource" && "text" in item.resource) {
        return item.resource.text;
      }
      if (item.type === "resource_link") {
        return `${item.name}: ${item.uri}`;
      }
      return `[${item.type}]`;
    })
    .join("\n");
}
