// Usage (the npm script loads .env via tsx --env-file):
//   npm run eval:generation
//   npm run eval:generation -- --user-email you@example.com --limit 5
//   npm run eval:generation -- --questions path/to/questions.jsonl --out results.jsonl
//
// The generation-side twin of scripts/eval.ts. For every question it runs the
// PRODUCTION answer path — hybrid retrieval → buildRetrievalPrompt →
// streamText with the pinned sampling — against whichever chat model the env
// selects (gpt-4o-mini by default, or CHAT_BASE_URL / CHAT_MODEL_ID; see
// src/lib/rag/model.ts). Run it once per provider to compare them on identical
// inputs. It calls the modules directly rather than POSTing to /api/chat, so
// Clerk auth and the 200-chats/day limit don't get in the way.
//
// Output: one JSON object per question (prompt, sources, reply, latency, token
// usage, per-citation verdicts, contract hash). The JSONL is the artifact the
// fine-tuning eval scores; the summary printed at the end is a quick smoke
// reading only.
//
// --questions file format: one JSON object per line, { id, question, category? }.
// Default question set: the 12 Aurora questions (upload
// test-fixtures/aurora-notebook-handbook.md to the chosen user first).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { streamText } from "ai";
import { prisma } from "@/lib/prisma";
import { AURORA_QUESTIONS } from "@/lib/eval/questions";
import { extractCitations, verifyCitation } from "@/lib/rag/citations";
import { buildContract } from "@/lib/rag/contract";
import { hybridRetrieve } from "@/lib/rag/hybrid";
import { getChatModel, resolveChatModelConfig } from "@/lib/rag/model";
import {
  CHAT_MAX_OUTPUT_TOKENS,
  CHAT_TEMPERATURE,
  NO_SOURCES_REPLY,
  SYSTEM_PROMPT,
  buildRetrievalPrompt,
  normalizeChunkText,
} from "@/lib/rag/prompt";
import { resolveUserId } from "./lib/resolveUser";

type Question = { id: string; question: string; category?: string };

type CliArgs = {
  userEmail?: string;
  userId?: string;
  questions?: string;
  out?: string;
  limit?: number;
};

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      console.log(
        "Usage: tsx scripts/eval-generation.ts [--user-email <email>] [--user-id <cuid>] [--questions <file.jsonl>] [--out <file.jsonl>] [--limit <N>]",
      );
      process.exit(0);
    }
    if (a === "--user-email" && argv[i + 1]) out.userEmail = argv[++i];
    else if (a === "--user-id" && argv[i + 1]) out.userId = argv[++i];
    else if (a === "--questions" && argv[i + 1]) out.questions = argv[++i];
    else if (a === "--out" && argv[i + 1]) out.out = argv[++i];
    else if (a === "--limit" && argv[i + 1]) out.limit = Number(argv[++i]);
  }
  return out;
}

function loadQuestions(file: string | undefined): Question[] {
  if (!file) return AURORA_QUESTIONS;
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line, i) => {
      const q = JSON.parse(line) as Partial<Question>;
      if (typeof q.id !== "string" || typeof q.question !== "string") {
        throw new Error(`${file}:${i + 1} needs string "id" and "question" fields`);
      }
      return { id: q.id, question: q.question, category: q.category };
    });
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const config = resolveChatModelConfig();
  const model = getChatModel(config);
  const contractSha256 = buildContract().sha256;

  const userId = await resolveUserId(args);
  if (!userId) {
    console.error("Provide --user-email <email> or --user-id <cuid>. See --help.");
    process.exitCode = 1;
    return;
  }

  let questions = loadQuestions(args.questions);
  if (args.limit && args.limit > 0) questions = questions.slice(0, args.limit);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeModel = config.modelId.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const outPath = path.resolve(
    args.out ?? `eval-output/generation-${config.provider}-${safeModel}-${stamp}.jsonl`,
  );

  console.log(
    `Generation eval: provider=${config.provider} model=${config.modelId} ` +
      `temperature=${CHAT_TEMPERATURE} maxOutputTokens=${CHAT_MAX_OUTPUT_TOKENS}`,
  );
  console.log(`contract sha256 ${contractSha256}`);
  console.log(`${questions.length} questions as userId=${userId}\n`);

  const rows: Array<Record<string, unknown>> = [];
  const stats = {
    answered: 0,
    errors: 0,
    formatCompliant: 0,
    withValidCitation: 0,
    withoutCitation: 0,
    citations: 0,
    validCitations: 0,
    ttft: [] as number[],
    latency: [] as number[],
  };

  for (const q of questions) {
    const chunks = await hybridRetrieve(userId, q.question);
    const sources = chunks.map((c) => ({
      documentName: c.documentName,
      chunkIndex: c.index,
      normalized: normalizeChunkText(c.content),
    }));
    const prompt = buildRetrievalPrompt(q.question, chunks);

    const base = {
      id: q.id,
      category: q.category ?? null,
      question: q.question,
      provider: config.provider,
      modelId: config.modelId,
      contractSha256,
      temperature: CHAT_TEMPERATURE,
      maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
      sources,
      prompt,
    };

    // Mirror the route: a first turn with nothing retrieved never reaches the
    // model — the app streams the canned reply instead.
    if (chunks.length === 0) {
      rows.push({ ...base, shortCircuit: true, output: NO_SOURCES_REPLY });
      console.log(`  [canned] ${q.id}`);
      continue;
    }

    const started = performance.now();
    let ttftMs: number | null = null;
    let output = "";
    let failure: unknown = null;

    try {
      const result = streamText({
        model,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
        temperature: CHAT_TEMPERATURE,
        maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
        // Why: streamText reports failures through the stream, not by
        // throwing; keep the default console noise out of the eval log.
        onError: () => {},
      });
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          if (ttftMs === null) ttftMs = performance.now() - started;
          output += part.text;
        } else if (part.type === "error") {
          failure = part.error;
        }
      }
      const latencyMs = performance.now() - started;

      if (failure) throw failure;

      const usage = await result.usage;
      const finishReason = await result.finishReason;
      const scan = extractCitations(output);
      const verdicts = scan.citations.map((c) => ({
        ...c,
        ...verifyCitation(
          c,
          chunks.map((ch) => ({ documentName: ch.documentName, content: ch.content })),
        ),
      }));
      const valid = verdicts.filter((v) => v.valid).length;

      stats.answered++;
      if (scan.malformed.length === 0) stats.formatCompliant++;
      if (valid > 0) stats.withValidCitation++;
      if (verdicts.length === 0 && scan.malformed.length === 0) stats.withoutCitation++;
      stats.citations += verdicts.length;
      stats.validCitations += valid;
      if (ttftMs !== null) stats.ttft.push(ttftMs);
      stats.latency.push(latencyMs);

      rows.push({
        ...base,
        shortCircuit: false,
        output,
        finishReason,
        ttftMs: ttftMs === null ? null : Math.round(ttftMs),
        latencyMs: Math.round(latencyMs),
        usage: {
          inputTokens: usage.inputTokens ?? null,
          outputTokens: usage.outputTokens ?? null,
        },
        citations: verdicts,
        malformedCitationLines: scan.malformed,
      });
      console.log(
        `  [${valid}/${verdicts.length} valid${scan.malformed.length ? `, ${scan.malformed.length} malformed` : ""}] ` +
          `${q.id} — ${Math.round(latencyMs)}ms`,
      );
    } catch (err) {
      stats.errors++;
      const message = err instanceof Error ? err.message : String(err);
      rows.push({ ...base, shortCircuit: false, output, error: message });
      console.log(`  [error] ${q.id} — ${message.slice(0, 160)}`);
    }
  }

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

  const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);
  console.log(`\nWrote ${rows.length} rows to ${outPath}`);
  console.log("Smoke summary (the JSONL is the real artifact):");
  console.log(`  answered by the model        ${stats.answered}  (errors: ${stats.errors})`);
  console.log(`  format-compliant replies     ${pct(stats.formatCompliant, stats.answered)}`);
  console.log(`  citations that verify        ${pct(stats.validCitations, stats.citations)}  (${stats.validCitations}/${stats.citations})`);
  console.log(`  replies with ≥1 valid cite   ${pct(stats.withValidCitation, stats.answered)}`);
  console.log(`  replies with no citation     ${stats.withoutCitation}  (abstentions or uncited answers — read them)`);
  console.log(`  median time to first token   ${median(stats.ttft)?.toFixed(0) ?? "n/a"} ms`);
  console.log(`  median total latency         ${median(stats.latency)?.toFixed(0) ?? "n/a"} ms`);

  if (stats.errors > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    // Why: SDK errors carry the whole HTTP response; the message alone says
    // what to fix (no credits, DB paused, bad CHAT_* config).
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
