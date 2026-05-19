import type { ContextBundle, ContextQuery, EvidenceItem, SourceCitation } from "./types.js";

const trustBoost = {
  trusted: 30,
  evidence: 15,
  untrusted: 0
} as const;

export function rankEvidence(items: EvidenceItem[], query: ContextQuery): EvidenceItem[] {
  const text = query.text.toLowerCase();
  return [...items]
    .map((item) => ({
      ...item,
      score: item.score + trustBoost[item.trust] + lexicalScore(item.text, text) + (item.repoId && query.repoIds.includes(item.repoId) ? 12 : 0)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, query.maxItems);
}

export function buildContextBundle(query: ContextQuery, evidence: EvidenceItem[], assumptions: string[]): ContextBundle {
  const ranked = rankEvidence(evidence, query);
  const citations = new Map<string, SourceCitation>();
  for (const item of ranked) {
    for (const citation of item.citations) {
      citations.set(`${citation.providerId}:${citation.label}:${citation.uri ?? ""}`, citation);
    }
  }
  return {
    query,
    evidence: ranked,
    citations: [...citations.values()],
    assumptions
  };
}

function lexicalScore(candidate: string, query: string): number {
  if (!query) {
    return 0;
  }
  const words = new Set(query.split(/\s+/).filter((word) => word.length >= 4));
  const normalized = candidate.toLowerCase();
  let score = 0;
  for (const word of words) {
    if (normalized.includes(word)) {
      score += 2;
    }
  }
  return Math.min(score, 20);
}
