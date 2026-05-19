import type { AssistantConfig, RepositoryConfig } from "../config/schema.js";
import type { SlackContext } from "../types.js";
import type { SignalDeskDb } from "../storage/sqlite.js";
import type { ContextBundle, ContextProvider, ContextQuery } from "./types.js";
import { buildContextBundle } from "./ranker.js";
import { defaultContextProviders } from "./providers.js";

export class ContextEngine {
  private readonly providers: ContextProvider[];

  constructor(
    private readonly config: AssistantConfig,
    private readonly db: SignalDeskDb,
    providers?: ContextProvider[]
  ) {
    this.providers = providers ?? [];
  }

  async build(input: {
    text: string;
    channel: string;
    userId?: string;
    repos: RepositoryConfig[];
    slackContext: SlackContext;
    priority: ContextQuery["priority"];
  }): Promise<ContextBundle> {
    const query: ContextQuery = {
      text: input.text,
      channel: input.channel,
      ...(input.userId === undefined ? {} : { userId: input.userId }),
      repoIds: input.repos.map((repo) => repo.id),
      slackContext: input.slackContext,
      priority: input.priority,
      maxItems: this.config.context.max_evidence_items
    };
    const providers = this.providers.length > 0 ? this.providers : defaultContextProviders(this.config, this.db, input.repos);
    const evidence = [];
    const assumptions = [];
    for (const provider of providers) {
      try {
        const result = await provider.query(query);
        evidence.push(...result.evidence);
        assumptions.push(...result.assumptions);
      } catch (error) {
        assumptions.push(`${provider.id}: ${String(error)}`);
      }
    }
    return buildContextBundle(query, evidence, assumptions);
  }
}
