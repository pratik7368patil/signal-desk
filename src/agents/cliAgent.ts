import type { AgentConfig } from "../config/schema.js";
import type { AgentPrompt, AgentResult } from "../types.js";
import { minimalEnv, runCommand } from "../utils/shell.js";

export interface CliAgentOptions {
  runner?: typeof runCommand;
}

export class CliAgent {
  private readonly runner: typeof runCommand;

  constructor(options: CliAgentOptions = {}) {
    this.runner = options.runner ?? runCommand;
  }

  async run(agent: AgentConfig, prompt: AgentPrompt): Promise<AgentResult> {
    const [command, ...args] = agent.command;
    if (!command) {
      return fallbackAgentResult("Agent command is empty");
    }

    const result = await this.runner(command, args, {
      input: JSON.stringify(prompt),
      timeoutMs: agent.timeout_seconds * 1_000,
      env: minimalEnv()
    });

    if (result.code !== 0 || result.timedOut) {
      return fallbackAgentResult(
        result.timedOut ? "Agent timed out" : result.stderr.trim() || "Agent command failed"
      );
    }

    try {
      return parseAgentResult(result.stdout);
    } catch (error) {
      return fallbackAgentResult(`Agent returned invalid JSON: ${String(error)}`);
    }
  }
}

export function parseAgentResult(stdout: string): AgentResult {
  const candidates = agentJsonCandidates(stdout);
  let lastError: unknown = new Error("no JSON object found");
  for (const candidate of candidates) {
    try {
      return coerceAgentResult(JSON.parse(candidate) as unknown);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function agentJsonCandidates(stdout: string): string[] {
  const trimmed = stdout.trim();
  const candidates = trimmed ? [trimmed] : [];
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"))
    .reverse();
  candidates.push(...lines);
  return [...new Set(candidates)];
}

function coerceAgentResult(parsed: unknown): AgentResult {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("expected object");
  }
  const value = parsed as Record<string, unknown>;
  if (typeof value.result === "string" && typeof value.draft !== "string") {
    return coerceAgentResult(JSON.parse(value.result) as unknown);
  }
  if (typeof value.draft !== "string") {
    throw new Error("draft must be a string");
  }
  const confidence =
    typeof value.confidence === "number"
      ? value.confidence
      : typeof value.confidence === "string"
        ? Number(value.confidence)
        : Number.NaN;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("confidence must be 0.0-1.0");
  }
  if (!Array.isArray(value.assumptions) || !value.assumptions.every((item) => typeof item === "string")) {
    throw new Error("assumptions must be a string array");
  }
  if (!Array.isArray(value.sources) || !value.sources.every((item) => typeof item === "string")) {
    throw new Error("sources must be a string array");
  }
  if (typeof value.needs_human_review !== "boolean") {
    throw new Error("needs_human_review must be boolean");
  }
  return {
    draft: value.draft,
    confidence,
    assumptions: value.assumptions,
    sources: value.sources,
    needs_human_review: value.needs_human_review
  };
}

export function fallbackAgentResult(reason: string): AgentResult {
  return {
    draft:
      "I gathered the Slack and repository context, but the local drafting agent failed before producing a reliable reply. Please review the context manually before responding.",
    confidence: 0,
    assumptions: [reason],
    sources: [],
    needs_human_review: true
  };
}
