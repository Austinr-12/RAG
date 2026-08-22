import type { RetrievedChunk } from "@/lib/rag/retrieve";
import type { EvalQuestion } from "./questions";
import { aggregate, scoreRetrieval, type SingleResult, type AggregateMetrics } from "./metrics";

// Why: the runner is decoupled from any specific retriever — pass a function
// that maps (userId, query, k) -> chunks and we score it. This is how we
// compare dense-only vs hybrid vs any future rerank strategy on the same
// question set with the same code path.
export type RetrieverFn = (
  userId: string,
  query: string,
  k: number,
) => Promise<RetrievedChunk[]>;

export type RunResult = {
  strategyName: string;
  k: number;
  perQuestion: SingleResult[];
  metrics: AggregateMetrics;
};

export async function runEval(
  strategyName: string,
  retriever: RetrieverFn,
  userId: string,
  questions: EvalQuestion[],
  k: number,
): Promise<RunResult> {
  const perQuestion: SingleResult[] = [];
  for (const q of questions) {
    const chunks = await retriever(userId, q.question, k);
    perQuestion.push(scoreRetrieval(q, chunks));
  }
  return {
    strategyName,
    k,
    perQuestion,
    metrics: aggregate(perQuestion),
  };
}

// Pretty-print a comparison table for two strategies over the same question
// set. Returns a markdown string so we can save it as `eval-results.md` for
// the portfolio.
export function comparisonMarkdown(runs: RunResult[]): string {
  if (runs.length === 0) return "";

  const header = ["Question ID", "Question"];
  for (const r of runs) header.push(`${r.strategyName}: rank`);

  const rows: string[][] = [];
  const firstIds = runs[0].perQuestion.map((r) => r.questionId);

  for (const qid of firstIds) {
    const row = [qid];
    let questionText = "";
    for (const run of runs) {
      const r = run.perQuestion.find((x) => x.questionId === qid);
      if (r) questionText = r.question;
    }
    row.push(questionText);
    for (const run of runs) {
      const r = run.perQuestion.find((x) => x.questionId === qid);
      row.push(r ? (r.rank === null ? "miss" : `#${r.rank}`) : "-");
    }
    rows.push(row);
  }

  const perQTable = renderTable(header, rows);

  const summaryHeader = ["Strategy", "n", "hit@K", "MRR", "mean top-1 sim"];
  const summaryRows = runs.map((r) => [
    r.strategyName,
    String(r.metrics.n),
    r.metrics.hitAtK.toFixed(3),
    r.metrics.mrr.toFixed(3),
    r.metrics.meanTopSimilarity.toFixed(3),
  ]);
  const summaryTable = renderTable(summaryHeader, summaryRows);

  return [
    `# Retrieval eval (K=${runs[0].k})`,
    "",
    "## Summary",
    "",
    summaryTable,
    "",
    "## Per-question rank of first relevant chunk",
    "",
    perQTable,
    "",
    "> `miss` = no chunk in top-K matched any expected substring.",
    "> `#N` = first relevant chunk was at rank N (lower is better).",
  ].join("\n");
}

function renderTable(header: string[], rows: string[][]): string {
  const sep = header.map(() => "---");
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [line(header), line(sep), ...rows.map(line)].join("\n");
}
