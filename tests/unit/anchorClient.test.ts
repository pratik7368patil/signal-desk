import { describe, expect, it } from "vitest";
import { AnchorClient } from "../../src/anchor/anchorClient.js";
import { buildAnchorIndexArgs } from "../../src/anchor/indexManager.js";
import type { McpToolClient } from "../../src/mcp/mcpClient.js";
import { testConfig } from "../helpers.js";

describe("anchor integration", () => {
  it("falls back gracefully when anchor binary is missing", async () => {
    const client = new AnchorClient({ exists: async () => false });
    const result = await client.query(testConfig().repositories, "payments incident");

    expect(result.available).toBe(false);
    expect(result.snippets).toEqual([]);
    expect(result.errors.join(" ")).toContain("anchor binary not found");
  });

  it("queries Anchor through the MCP anchor_get_context tool", async () => {
    const calls: Array<{ toolName: string; args: Record<string, unknown> }> = [];
    const mcpClient = {
      callTool: async (_server: unknown, toolName: string, args: Record<string, unknown>) => {
        calls.push({ toolName, args });
        return {
          serverId: "anchor-payments",
          toolName,
          ok: true,
          isError: false,
          text: "# Anchor Context\n\nEvidence: PR #42",
          structuredContent: {
            items: [{ score: 12 }]
          }
        };
      }
    } as unknown as McpToolClient;
    const client = new AnchorClient({ exists: async () => true, mcpClient });

    const result = await client.query([testConfig().repositories[0]!], "payments incident", 8);

    expect(calls).toEqual([{ toolName: "anchor_get_context", args: { task: "payments incident", maxResults: 8 } }]);
    expect(result.snippets[0]).toMatchObject({
      repoId: "payments",
      title: "Anchor PR history",
      text: expect.stringContaining("PR #42"),
      score: 12
    });
  });

  it("reports Anchor status failures without throwing", async () => {
    const mcpClient = {
      callTool: async () => {
        throw new Error("spawn anchor ENOENT");
      }
    } as unknown as McpToolClient;
    const client = new AnchorClient({ exists: async () => true, mcpClient });

    const result = await client.status(testConfig().repositories[0]!);

    expect(result).toMatchObject({
      available: true,
      ok: false,
      message: expect.stringContaining("spawn anchor ENOENT")
    });
  });

  it("excludes secret patterns from anchor index args", () => {
    const repo = {
      ...testConfig().repositories[0]!,
      include: ["src/**", ".env*", "secrets/**", "README.md"],
      exclude: []
    };

    const args = buildAnchorIndexArgs(repo);
    expect(args).toEqual(["index", "--repo", "owner/payments-service", "--limit", "200"]);
    expect(args).not.toContain("--include");
    expect(args).not.toContain("--exclude");
    expect(args).not.toContain(".env*");
    expect(args).not.toContain("secrets/**");
  });
});
