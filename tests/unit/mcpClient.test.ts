import { describe, expect, it } from "vitest";
import { McpToolClient } from "../../src/mcp/mcpClient.js";

describe("McpToolClient", () => {
  it("returns a structured failure when the MCP command cannot spawn", async () => {
    const client = new McpToolClient();

    const result = await client.callTool(
      {
        id: "missing",
        enabled: true,
        command: ["signald-definitely-missing-mcp-binary"],
        env_allowlist: ["HOME", "PATH"],
        timeout_seconds: 1,
        local_only: true,
        read_only: true,
        allowed_tools: ["example_tool"]
      },
      "example_tool",
      {}
    );

    expect(result).toMatchObject({
      serverId: "missing",
      toolName: "example_tool",
      ok: false,
      isError: true
    });
    expect(result.text).toContain("MCP server missing failed");
  });
});
