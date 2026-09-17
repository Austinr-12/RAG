// Usage:
//   npm run export:corpus -- --in <dir of source docs> --out <chunks.jsonl>
//
// Turns a folder of PDFs / .txt / .md files into chunks using the app's OWN
// ingestion code — the same extractText, the same chunkText, the same upload
// limits, the same whitespace normalization the prompt applies. The fine-tuning
// pipeline builds its training contexts from this file, so training data can
// never drift from what production retrieval actually feeds the model. (A
// Python re-implementation of the chunker would drift: it drops separators,
// counts UTF-16 units, and PDFs go through pdf-parse first.)
//
// One JSON object per line:
//   { documentName, chunkIndex, chunkCount, content, normalized }
//   - content     the chunk exactly as it would be stored in the DB
//   - normalized  the chunk exactly as buildRetrievalPrompt shows it to the model
//
// No env, DB or network needed. Nothing is embedded or uploaded.

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chunkText } from "@/lib/rag/chunking";
import { extractText, inferMimeType, isSupportedMimeType } from "@/lib/rag/extract";
import { normalizeChunkText } from "@/lib/rag/prompt";
import { UPLOAD_LIMITS } from "@/lib/security/rateLimit";

type CliArgs = { inDir?: string; outFile?: string };

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      console.log("Usage: tsx scripts/export-corpus.ts --in <dir> --out <file.jsonl>");
      process.exit(0);
    }
    if (a === "--in" && argv[i + 1]) out.inDir = argv[++i];
    else if (a === "--out" && argv[i + 1]) out.outFile = argv[++i];
  }
  return out;
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile()) files.push(full);
  }
  // Sorted so the output is reproducible across machines and runs.
  return files.sort((a, b) => a.localeCompare(b, "en"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.inDir || !args.outFile) {
    console.error("Both --in <dir> and --out <file.jsonl> are required. See --help.");
    process.exit(1);
  }
  const inDir = path.resolve(args.inDir);
  const outFile = path.resolve(args.outFile);
  if (!statSync(inDir, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`Not a directory: ${inDir}`);
    process.exit(1);
  }

  const lines: string[] = [];
  const seenNames = new Map<string, string>();
  let documents = 0;
  let skipped = 0;

  const skip = (file: string, reason: string) => {
    skipped++;
    console.warn(`  skip  ${path.relative(inDir, file)} — ${reason}`);
  };

  for (const file of walk(inDir)) {
    // Mirror the upload route's checks so every exported document is one the
    // app would really have accepted.
    const mime = inferMimeType(file);
    if (!isSupportedMimeType(mime)) {
      skip(file, "unsupported type (PDF, .txt, .md, .markdown only)");
      continue;
    }
    const size = statSync(file).size;
    if (size === 0) {
      skip(file, "empty file");
      continue;
    }
    if (size > UPLOAD_LIMITS.maxBytes) {
      skip(file, "exceeds the app's 10MB upload limit");
      continue;
    }

    // The app stores the uploaded filename as the document name, and the
    // model cites documents by that name.
    const documentName = path.basename(file).slice(0, UPLOAD_LIMITS.maxFilenameChars);
    const clash = seenNames.get(documentName);
    if (clash) {
      skip(file, `duplicate document name (already exported from ${clash}); citations would be ambiguous`);
      continue;
    }

    let text: string;
    try {
      text = await extractText(readFileSync(file), mime);
    } catch (err) {
      skip(file, `extraction failed: ${(err as Error).message}`);
      continue;
    }
    if (!text.trim()) {
      skip(file, "no extractable text");
      continue;
    }

    const chunks = chunkText(text);
    if (chunks.length > UPLOAD_LIMITS.maxChunksPerFile) {
      skip(
        file,
        `${chunks.length} chunks exceeds the app's per-file limit of ${UPLOAD_LIMITS.maxChunksPerFile}; split the file`,
      );
      continue;
    }

    seenNames.set(documentName, path.relative(inDir, file));
    documents++;
    chunks.forEach((content, chunkIndex) => {
      lines.push(
        JSON.stringify({
          documentName,
          chunkIndex,
          chunkCount: chunks.length,
          content,
          normalized: normalizeChunkText(content),
        }),
      );
    });
    console.log(`  ok    ${path.relative(inDir, file)} → ${chunks.length} chunks`);
  }

  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, lines.length > 0 ? `${lines.join("\n")}\n` : "", "utf8");
  console.log(
    `\nWrote ${lines.length} chunks from ${documents} documents to ${outFile} (${skipped} skipped)`,
  );
  if (documents === 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
