// Usage:
//   npm run export:contract
//
// Writes contract/prompt-contract.json — the machine-readable description of
// what the chat model is given and what it must produce (system prompt,
// rendered-prompt golden samples, citation rule, chunking, top-K, sampling).
// The fine-tuning pipeline in ../rag-finetune reads this file instead of
// re-implementing any of it. `npm test` fails while the file is stale.
//
// No env, DB or network needed.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  CONTRACT_RELATIVE_PATH,
  buildContract,
  serializeContract,
  type PromptContract,
} from "@/lib/rag/contract";

const outPath = path.resolve(process.cwd(), CONTRACT_RELATIVE_PATH);
const contract = buildContract();

let previousSha: string | null = null;
if (existsSync(outPath)) {
  try {
    previousSha = (JSON.parse(readFileSync(outPath, "utf8")) as PromptContract).sha256;
  } catch {
    previousSha = null;
  }
}

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, serializeContract(contract), "utf8");

console.log(`Wrote ${CONTRACT_RELATIVE_PATH}`);
console.log(`  sha256 ${contract.sha256}`);
if (previousSha && previousSha !== contract.sha256) {
  console.log(`  was    ${previousSha}`);
  console.log(
    "  The contract changed: datasets and models built against the old hash no longer match this app.",
  );
} else if (previousSha) {
  console.log("  (unchanged)");
}
