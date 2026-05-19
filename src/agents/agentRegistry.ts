import type { AgentConfig, AssistantConfig } from "../config/schema.js";

export function getAgent(config: AssistantConfig, id = config.agents.default): AgentConfig {
  const agent = config.agents.available.find((candidate) => candidate.id === id);
  if (!agent) {
    throw new Error(`Unknown agent: ${id}`);
  }
  enforceAgentPolicy(config, agent);
  return agent;
}

export function enforceAgentPolicy(config: AssistantConfig, agent: AgentConfig): void {
  if (!config.security.allow_network_for_agents && !agent.local_only) {
    throw new Error(`Agent ${agent.id} is not marked local_only`);
  }
  if (config.security.allow_agent_file_writes) {
    throw new Error("Agent file writes are not supported yet");
  }
}
