import type { RetrievedChunk } from "@/lib/rag/retrieve";
import type { EvalQuestion } from "./questions";

// Why: normalize whitespace + case so substring matches survive line breaks,
// extra spaces, and case differences that are meaningless to the answer.
export function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function chunkMatches(chunk: RetrievedChunk, q: EvalQuestion): boolean {
  const normalized = normalize(chunk.content);
  return q.expectedSubstrings.some((s) => normalized.includes(normalize(s)));
}

export type SingleResult = {
  questionId: string;
  question: string;
  hit: boolean; // did at least one retrieved chunk match within top-K?
  rank: number | null; // 1-indexed rank of first hit, null if none
  topSimilarity: number | null; // similarity of top-1 chunk
  topContent: string; // preview of top-1 chunk (first 120 chars)
};

/**
 * Score a single retrieval against an expected answer. `rank` is the position
 * of the FIRST chunk that matches — earlier is better. MRR aggregates the
 * reciprocal of these ranks across the whole question set.
 */
export function scoreRetrieval(
  q: EvalQuestion,
  retrieved: RetrievedChunk[],
): SingleResult {
  let rank: number | null = null;
  for (let i = 0; i < retrieved.length; i++) {
    if (chunkMatches(retrieved[i], q)) {
      rank = i + 1;
      break;
    }
  }
  const top = retrieved[0];
  return {
    questionId: q.id,
    question: q.question,
    hit: rank !== null,
    rank,
    topSimilarity: top ? top.similarity : null,
    topContent: top ? top.content.replace(/\s+/g, " ").slice(0, 120) : "",
  };
}

export type AggregateMetrics = {
  n: number;
  hitAtK: number; // fraction of questions with at least one relevant chunk in top-K
  mrr: number; // mean reciprocal rank
  meanTopSimilarity: number; // average similarity of top-1 chunk
};

export function aggregate(results: SingleResult[]): AggregateMetrics {
  const n = results.length;
  if (n === 0) {
    return { n: 0, hitAtK: 0, mrr: 0, meanTopSimilarity: 0 };
  }
  const hits = results.filter((r) => r.hit).length;
  const rrSum = results.reduce(
    (acc, r) => acc + (r.rank === null ? 0 : 1 / r.rank),
    0,
  );
  const simSum = results.reduce(
    (acc, r) => acc + (r.topSimilarity ?? 0),
    0,
  );
  return {
    n,
    hitAtK: hits / n,
    mrr: rrSum / n,
    meanTopSimilarity: simSum / n,
  };
}
