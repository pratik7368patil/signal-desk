import type { PriorityDecision, SlackContext } from "../types.js";

export type EvidenceSourceType = "slack" | "anchor" | "local_docs" | "mcp" | "profile" | "config";
export type EvidenceTrustLevel = "trusted" | "evidence" | "untrusted";

export interface SourceCitation {
  label: string;
  uri?: string;
  providerId: string;
  sourceType: EvidenceSourceType;
}

export interface EvidenceItem {
  id: string;
  providerId: string;
  sourceType: EvidenceSourceType;
  trust: EvidenceTrustLevel;
  title: string;
  text: string;
  repoId?: string;
  path?: string;
  uri?: string;
  score: number;
  citations: SourceCitation[];
  createdAt?: string;
}

export interface ContextQuery {
  text: string;
  channel: string;
  userId?: string;
  repoIds: string[];
  slackContext: SlackContext;
  priority: PriorityDecision;
  maxItems: number;
}

export interface ContextBundle {
  query: ContextQuery;
  evidence: EvidenceItem[];
  citations: SourceCitation[];
  assumptions: string[];
}

export interface ContextProvider {
  id: string;
  sourceType: EvidenceSourceType;
  query(input: ContextQuery): Promise<{ evidence: EvidenceItem[]; assumptions: string[] }>;
}
