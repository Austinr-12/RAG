// scripts/test-extract.ts
// Smoke test for src/lib/rag/extract.ts — validates PDF + .txt text extraction
// end to end, the same parser ingest.ts uses for uploads.
//
// Run with (no install / no network needed):
//   node --experimental-strip-types scripts/test-extract.ts
//
// Optional — point it at your own files instead of the generated fixtures:
//   node --experimental-strip-types scripts/test-extract.ts path/to/a.pdf path/to/b.txt
//
// Imported via relative path on purpose: src/lib/rag/extract.ts has no `@/`
// aliases and no DB/OpenAI imports, so node's native TS stripping can load it.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractText } from "../src/lib/rag/extract.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures");

const SAMPLE_TXT = `Sample plain-text document.

This file exercises the text/plain branch of extractText(). It contains
multiple paragraphs and a short list so the chunker has something real to
split later:

- alpha — the first item
- beta  — the second item
- gamma — the third item

Retrieval-augmented generation depends on clean text extraction; if this
round-trips intact, the .txt path is sound.

End of sample.
`;

const SAMPLE_PDF_TEXT =
  "Hello from the sample PDF. If you can read this line, pdf-parse extracted text correctly.";

// Build a minimal but spec-valid single-page PDF. xref byte offsets are
// computed (never hand-typed) so pdfjs — which is strict about the xref
// table — accepts it. latin1 throughout keeps string length == byte length.
function buildMinimalPdf(message: string): Buffer {
  const text = message
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET\n`;
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\n` +
      `stream\n${stream}endstream`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
  ];

  let body = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(body, "latin1");
  const size = objects.length + 1;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;

  const trailer =
    `trailer\n<< /Size ${size} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body + xref + trailer, "latin1");
}

function mimeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".md" || ext === ".markdown") return "text/markdown";
  return "text/plain";
}

async function ensureFixtures(): Promise<string[]> {
  if (!existsSync(fixturesDir)) await mkdir(fixturesDir, { recursive: true });
  const txtPath = join(fixturesDir, "sample.txt");
  const pdfPath = join(fixturesDir, "sample.pdf");
  if (!existsSync(txtPath)) await writeFile(txtPath, SAMPLE_TXT, "utf8");
  if (!existsSync(pdfPath)) {
    await writeFile(pdfPath, buildMinimalPdf(SAMPLE_PDF_TEXT));
  }
  return [pdfPath, txtPath];
}

let failures = 0;

async function runOne(path: string): Promise<void> {
  const buf = await readFile(path);
  const mime = mimeFor(path);
  console.log(`\n=== ${path}`);
  console.log(`    ${mime} · ${buf.length} bytes on disk`);
  let text: string;
  try {
    text = await extractText(buf, mime);
  } catch (err) {
    console.error(`❌ extractText threw: ${(err as Error).message}`);
    failures++;
    return;
  }
  const preview = text.trim().slice(0, 300).replace(/\s+/g, " ");
  console.log(`    extracted ${text.length} chars`);
  console.log(`    preview: "${preview}${text.length > 300 ? "…" : ""}"`);
  if (!text.trim()) {
    console.error("❌ extraction is empty");
    failures++;
    return;
  }
  // For the generated PDF we know exactly what the text should contain.
  if (mime === "application/pdf" && !text.includes("pdf-parse extracted")) {
    console.error("❌ PDF text missing expected marker phrase");
    failures++;
    return;
  }
  console.log("✓ non-empty extraction");
}

const args = process.argv.slice(2);
const targets = args.length > 0 ? args : await ensureFixtures();
for (const t of targets) await runOne(t);

console.log(
  `\n${failures === 0 ? "✓ all" : `❌ ${failures}`} extraction check(s) ` +
    `over ${targets.length} file(s)`,
);
if (failures > 0) process.exit(1);
