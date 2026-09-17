// Usage (the npm script loads .env via tsx --env-file):
//   npm run eval -- --user-email you@example.com
//   npm run eval -- --user-id cku... --k 5
//
// Runs the full question set against every registered retrieval strategy and
// writes a markdown comparison table to eval-results.md.
//
// Prerequisite: test-fixtures/aurora-notebook-handbook.md must be uploaded to
// the chosen user's account — the questions are derived from it.

import { writeFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { hybridRetrieve } from "@/lib/rag/hybrid";
import { RETRIEVE_DEFAULT_K, retrieve } from "@/lib/rag/retrieve";
import { AURORA_QUESTIONS } from "@/lib/eval/questions";
import { comparisonMarkdown, runEval, type RetrieverFn } from "@/lib/eval/runner";
import { resolveUserId } from "./lib/resolveUser";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const k = args.k ?? RETRIEVE_DEFAULT_K;

  const userId = await resolveUserId(args);
  if (!userId) {
    console.error(
      "Provide --user-email <email> or --user-id <cuid>. See --help.",
    );
    process.exit(1);
  }

  console.log(`Running eval as userId=${userId}, K=${k}, ${AURORA_QUESTIONS.length} questions`);
  console.log();

  const strategies: Array<{ name: string; fn: RetrieverFn }> = [
    {
      name: "dense-only",
      fn: (u, q, kk) => retrieve(u, q, { k: kk }),
    },
    {
      name: "hybrid-rrf",
      fn: (u, q, kk) => hybridRetrieve(u, q, { k: kk }),
    },
    // Additional strategies get added here as we implement them.
  ];

  const runs = [];
  for (const strat of strategies) {
    console.log(`Strategy: ${strat.name}`);
    const run = await runEval(strat.name, strat.fn, userId, AURORA_QUESTIONS, k);
    for (const r of run.perQuestion) {
      const flag = r.hit ? `#${r.rank}` : "miss";
      console.log(`  [${flag.padStart(4)}] ${r.questionId} — ${r.question.slice(0, 60)}`);
    }
    console.log(
      `  → hit@${k}=${run.metrics.hitAtK.toFixed(3)}  MRR=${run.metrics.mrr.toFixed(3)}  meanSim=${run.metrics.meanTopSimilarity.toFixed(3)}`,
    );
    console.log();
    runs.push(run);
  }

  const md = comparisonMarkdown(runs);
  const outPath = "eval-results.md";
  writeFileSync(outPath, md);
  console.log(`Wrote ${outPath}`);
}

type CliArgs = { userEmail?: string; userId?: string; k?: number };

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      console.log(
        "Usage: tsx scripts/eval.ts [--user-email <email>] [--user-id <cuid>] [--k <N>]",
      );
      process.exit(0);
    }
    if (a === "--user-email" && argv[i + 1]) out.userEmail = argv[++i];
    else if (a === "--user-id" && argv[i + 1]) out.userId = argv[++i];
    else if (a === "--k" && argv[i + 1]) out.k = Number(argv[++i]);
  }
  return out;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  // Why: the pg pool keeps the event loop alive; release it so the script
  // exits as soon as the work is done.
  .finally(() => prisma.$disconnect());
