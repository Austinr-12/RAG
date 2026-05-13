// scripts/test-chunker.ts
// Quick smoke test for src/lib/rag/chunking.ts.
// Run with:  npx tsx scripts/test-chunker.ts
import { chunkText, CHUNK_SIZE, CHUNK_OVERLAP } from "../src/lib/rag/chunking.ts";

const sample = `# Paper

## Abstract

This paper presents a novel approach to retrieval-augmented generation. We
demonstrate that hybrid search combined with neural re-ranking produces
substantially better answers than vector similarity alone. Across a curated
eval set of 200 questions over technical documentation, we improve top-1
chunk recall from 71% to 89%.

## 1. Introduction

Retrieval-augmented generation (RAG) systems combine a retrieval step (find
documents relevant to a question) with a generation step (an LLM produces an
answer conditioned on those documents). The retrieval step is the bottleneck
on answer quality: an LLM cannot answer correctly using irrelevant context.

Most introductory RAG implementations use cosine similarity over OpenAI
embeddings of dense text chunks. This works adequately for general prose but
fails on (a) exact-term queries where vocabulary mismatch hides relevant
documents, and (b) corpora where one chunk's surface text resembles many
others.

## 2. Method

### 2.1 Hybrid retrieval

We score each candidate chunk twice: once by vector similarity against an
embedding of the query, and once by Postgres full-text search using the
ts_rank function. The two rankings are fused using reciprocal rank fusion
with a constant of 60. This is a strict generalization of either pure
strategy and recovers the strengths of both.

### 2.2 Cross-encoder re-ranking

After fusion, we take the top 50 candidates and pass them through Cohere's
rerank-english-v3.0 model, which scores each (query, chunk) pair using a
cross-encoder rather than independent embeddings. The top 8 re-ranked
chunks are passed to the LLM.

## 3. Results

See Table 1 for ablations.`;

console.log(`Input: ${sample.length} chars`);
console.log(`Settings: chunkSize=${CHUNK_SIZE}, chunkOverlap=${CHUNK_OVERLAP}`);
console.log("---");

const chunks = chunkText(sample);
console.log(`Output: ${chunks.length} chunks`);
chunks.forEach((c, i) => {
  console.log(
    `\n[${i}] ${c.length} chars` +
      `  first40="${c.slice(0, 40).replace(/\n/g, "\\n")}..."` +
      `  last40="...${c.slice(-40).replace(/\n/g, "\\n")}"`,
  );
});

// Sanity assertions
const oversized = chunks.filter((c) => c.length > CHUNK_SIZE);
if (oversized.length > 0) {
  console.error(`\n❌ ${oversized.length} chunk(s) exceed chunkSize`);
  process.exit(1);
}
console.log(`\n✓ All ${chunks.length} chunks within chunkSize`);

// Verify overlap actually present between consecutive chunks.
// The merge step prepends `prev.slice(-maxOverlap)` to the next chunk, so
// the next chunk should start with a substring drawn from the previous one.
let overlapFailures = 0;
for (let i = 1; i < chunks.length; i++) {
  const prev = chunks[i - 1];
  const curr = chunks[i];
  // Find the longest prefix of curr that appears in prev. We scan a window
  // up to CHUNK_OVERLAP chars (plus a little slack for the joining space).
  const maxProbe = Math.min(curr.length, CHUNK_OVERLAP + 4);
  let overlapLen = 0;
  for (let n = maxProbe; n >= 20; n--) {
    if (prev.includes(curr.slice(0, n))) {
      overlapLen = n;
      break;
    }
  }
  if (overlapLen === 0) {
    console.error(`❌ chunks ${i - 1}→${i}: no overlap detected`);
    overlapFailures++;
  } else {
    console.log(`✓ chunks ${i - 1}→${i}: ${overlapLen} chars of overlap`);
  }
}
if (overlapFailures > 0) process.exit(1);
