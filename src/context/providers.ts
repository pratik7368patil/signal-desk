import { AnchorClient } from "../anchor/anchorClient.js";
import type { AssistantConfig, RepositoryConfig } from "../config/schema.js";
import { LocalDocsRepo } from "../storage/localDocsRepo.js";
import { SlackCacheRepo } from "../storage/slackCacheRepo.js";
import type { SignalDeskDb } from "../storage/sqlite.js";
import type { SlackWebClientLike } from "../types.js";
import type { ContextProvider, ContextQuery, EvidenceItem } from "./types.js";

export class SlackEvidenceProvider implements ContextProvider {
  id = "slack";
  sourceType = "slack" as const;

  constructor(private readonly client?: SlackWebClientLike) {}

  async query(input: ContextQuery): Promise<{ evidence: EvidenceItem[]; assumptions: string[] }> {
    const evidence = input.slackContext.messages.slice(-12).map((message, index): EvidenceItem => {
      const uri = input.slackContext.permalink;
      return {
        id: `slack:${message.ts}:${index}`,
        providerId: this.id,
        sourceType: this.sourceType,
        trust: "untrusted",
        title: `Slack message ${message.ts}`,
        text: message.text,
        score: 5,
        ...(uri === undefined ? {} : { uri }),
        citations: [{ label: `Slack ${message.ts}`, providerId: this.id, sourceType: this.sourceType, ...(uri === undefined ? {} : { uri }) }],
        createdAt: message.ts
      };
    });
    const searchEvidence = await this.searchSlack(input);
    evidence.push(...searchEvidence.evidence);
    const assumptions = searchEvidence.available ? [] : ["Slack search unavailable or not permitted; used thread/history context only."];
    return { evidence, assumptions };
  }

  private async searchSlack(input: ContextQuery): Promise<{ available: boolean; evidence: EvidenceItem[] }> {
    if (!this.client?.search?.messages) {
      return { available: false, evidence: [] };
    }
    try {
      const result = await this.client.search.messages({
        query: input.text,
        count: 5,
        sort: "timestamp"
      });
      const matches = (result.messages as { matches?: unknown } | undefined)?.matches;
      if (!Array.isArray(matches)) {
        return { available: true, evidence: [] };
      }
      return {
        available: true,
        evidence: matches
          .map((match, index): EvidenceItem | undefined => {
            if (typeof match !== "object" || match === null) {
              return undefined;
            }
            const row = match as Record<string, unknown>;
            const text = typeof row.text === "string" ? row.text : "";
            if (!text) {
              return undefined;
            }
            const permalink = typeof row.permalink === "string" ? row.permalink : undefined;
            const ts = typeof row.ts === "string" ? row.ts : `search-${index}`;
            return {
              id: `slack-search:${ts}:${index}`,
              providerId: this.id,
              sourceType: this.sourceType,
              trust: "untrusted",
              title: `Slack search result ${index + 1}`,
              text,
              score: 4,
              ...(permalink === undefined ? {} : { uri: permalink }),
              citations: [
                {
                  label: `Slack search ${index + 1}`,
                  providerId: this.id,
                  sourceType: this.sourceType,
                  ...(permalink === undefined ? {} : { uri: permalink })
                }
              ],
              createdAt: ts
            };
          })
          .filter((item): item is EvidenceItem => item !== undefined)
      };
    } catch {
      return { available: false, evidence: [] };
    }
  }
}

export class SlackCacheEvidenceProvider implements ContextProvider {
  id = "slack_cache";
  sourceType = "slack" as const;
  private readonly repo: SlackCacheRepo;

  constructor(db: SignalDeskDb) {
    this.repo = new SlackCacheRepo(db);
  }

  async query(input: ContextQuery): Promise<{ evidence: EvidenceItem[]; assumptions: string[] }> {
    const results = this.repo.search(input.text, Math.min(input.maxItems, 8));
    return {
      evidence: results.map((result): EvidenceItem => ({
        id: `slack-cache:${result.id}`,
        providerId: this.id,
        sourceType: this.sourceType,
        trust: "untrusted",
        title: `Recent Slack context ${result.ts}`,
        text: result.snippet,
        score: 3 - result.score,
        ...(result.permalink === undefined ? {} : { uri: result.permalink }),
        citations: [
          {
            label: `Slack cache ${result.ts}`,
            providerId: this.id,
            sourceType: this.sourceType,
            ...(result.permalink === undefined ? {} : { uri: result.permalink })
          }
        ],
        createdAt: result.ts
      })),
      assumptions: []
    };
  }
}

export class AnchorEvidenceProvider implements ContextProvider {
  id = "anchor";
  sourceType = "anchor" as const;

  constructor(
    private readonly repos: RepositoryConfig[],
    private readonly anchorClient = new AnchorClient()
  ) {}

  async query(input: ContextQuery): Promise<{ evidence: EvidenceItem[]; assumptions: string[] }> {
    const selected = this.repos.filter((repo) => input.repoIds.includes(repo.id));
    const result = await this.anchorClient.query(selected, input.text);
    const evidence = result.snippets.map((snippet, index): EvidenceItem => ({
      id: `anchor:${snippet.repoId}:${index}`,
      providerId: this.id,
      sourceType: this.sourceType,
      trust: "evidence",
      title: snippet.title ?? `Anchor context for ${snippet.repoId}`,
      text: snippet.text,
      repoId: snippet.repoId,
      ...(snippet.path === undefined ? {} : { path: snippet.path }),
      score: snippet.score ?? 10,
      citations: [
        {
          label: snippet.title ?? `Anchor ${snippet.repoId}`,
          providerId: this.id,
          sourceType: this.sourceType,
          ...(snippet.path === undefined ? {} : { uri: snippet.path })
        }
      ]
    }));
    return { evidence, assumptions: result.errors };
  }
}

export class LocalDocsEvidenceProvider implements ContextProvider {
  id = "local_docs";
  sourceType = "local_docs" as const;
  private readonly repo: LocalDocsRepo;

  constructor(db: SignalDeskDb) {
    this.repo = new LocalDocsRepo(db);
  }

  async query(input: ContextQuery): Promise<{ evidence: EvidenceItem[]; assumptions: string[] }> {
    const results = this.repo.search(input.text, Math.min(input.maxItems, 12));
    const evidence = results.map((result): EvidenceItem => ({
      id: `docs:${result.id}`,
      providerId: this.id,
      sourceType: this.sourceType,
      trust: "evidence",
      title: result.title ?? result.path,
      text: result.snippet,
      ...(result.repoId === undefined ? {} : { repoId: result.repoId }),
      path: result.path,
      uri: result.path,
      score: 10 - result.score,
      citations: [{ label: result.path, uri: result.path, providerId: this.id, sourceType: this.sourceType }]
    }));
    return { evidence, assumptions: [] };
  }
}

export function defaultContextProviders(config: AssistantConfig, db: SignalDeskDb, repos: RepositoryConfig[]): ContextProvider[] {
  const providers: ContextProvider[] = [new SlackEvidenceProvider(), new SlackCacheEvidenceProvider(db), new AnchorEvidenceProvider(repos)];
  if (config.local_docs.length > 0) {
    providers.push(new LocalDocsEvidenceProvider(db));
  }
  return providers;
}
