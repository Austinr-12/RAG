// Usage:
//   npx tsx scripts/eval.ts --user-email you@example.com
//   npx tsx scripts/eval.ts --user-id cku... --k 5
//
// Runs the full question set against every registered retrieval strategy and
// writes a markdown comparison table to eval-results.md.

import { writeFileSync } from "node:fs";
import { config as dotenv } from "dotenv";
import { prisma } from "@/lib/prisma";
import { retrieve } from "@/lib/rag/retrieve";
import { AURORA_QUESTIONS } from "@/lib/eval/questions";
import { comparisonMarkdown, runEval, type RetrieverFn } from "@/lib/eval/runner";

// Load .env — the Next dev server does this automatically, but this script
// runs outside that lifecycle.
dotenv();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const k = args.k ?? 5;

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
    // Additional strategies get added here as we implement them.
  ];

  // Optionally include hybrid if it's been implemented — dynamic import so
  // this script keeps working before hybrid.ts exists.
  try {
    const mod = await import("@/lib/rag/hybrid");
    strategies.push({
      name: "hybrid-rrf",
      fn: (u, q, kk) => mod.hybridRetrieve(u, q, { k: kk }),
    });
  } catch {
    console.log("(hybrid.ts not present yet — running dense-only baseline)\n");
  }

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

async function resolveUserId(args: CliArgs): Promise<string | null> {
  if (args.userId) return args.userId;
  if (args.userEmail) {
    const u = await prisma.user.findUnique({
      where: { email: args.userEmail },
      select: { id: true },
    });
    if (!u) {
      console.error(`No user found with email ${args.userEmail}`);
      return null;
    }
    return u.id;
  }
  // Fallback: if there's exactly one user in the DB, use them. Convenient for
  // solo dev; refuses to guess when ambiguous.
  const all = await prisma.user.findMany({ select: { id: true, email: true } });
  if (all.length === 1) {
    console.log(`(Using the only user in the DB: ${all[0].email})`);
    return all[0].id;
  }
  if (all.length > 1) {
    console.error(
      `Multiple users found (${all.length}); pass --user-email or --user-id.`,
    );
    console.error("Known emails:", all.map((u) => u.email).join(", "));
  }
  return null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
