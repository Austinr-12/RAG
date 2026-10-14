"""Quality report for the exported corpus chunks.

    python scripts/corpus_stats.py                      # reads data/generated/chunks.jsonl
    python scripts/corpus_stats.py --chunks path.jsonl --out results/phase1/corpus-report.md

Joins the app-exported chunks (one row per chunk: documentName, chunkIndex,
chunkCount, content, normalized) with data/corpus-manifest.json and reports,
per document and per library: chunk count, characters, the share of
alphabetic characters, the share of very short lines (PDF extraction
debris), and a verdict. Documents flagged as junk should be removed from the
manifest or replaced before Phase 1 generation, because every training
context is drawn from these chunks.

Heuristics, chosen to catch what pdf-parse gets wrong (scanned pages, column
soup, tables of numbers) without rejecting code-heavy docs:
  - alpha_ratio < 0.55           mostly numbers/symbols/whitespace
  - short_line_ratio > 0.45      many lines under 25 chars (tables, layouts)
  - chunks < 3                   too small for a 5-chunk context with neighbors removed
  - replacement chars present    encoding damage
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "data" / "corpus-manifest.json"


def doc_stats(rows: list[dict]) -> dict:
    text = "\n".join(r["content"] for r in rows)
    n = max(1, len(text))
    alpha = sum(ch.isalpha() for ch in text) / n
    lines = [ln for ln in text.splitlines() if ln.strip()]
    short = sum(1 for ln in lines if len(ln.strip()) < 25) / max(1, len(lines))
    chunk_lens = [len(r["normalized"]) for r in rows]
    return {
        "chunks": len(rows),
        "chars": len(text),
        "alpha_ratio": round(alpha, 3),
        "short_line_ratio": round(short, 3),
        "mean_chunk_chars": round(sum(chunk_lens) / max(1, len(chunk_lens))),
        "replacement_chars": text.count("�"),
    }


def verdict(s: dict) -> str:
    flags = []
    if s["alpha_ratio"] < 0.55:
        flags.append("low-alpha")
    if s["short_line_ratio"] > 0.45:
        flags.append("short-lines")
    if s["chunks"] < 3:
        flags.append("too-small")
    if s["replacement_chars"]:
        flags.append("encoding")
    return ",".join(flags) if flags else "ok"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--chunks", type=Path, default=ROOT / "data" / "generated" / "chunks.jsonl")
    ap.add_argument("--out", type=Path, default=ROOT / "results" / "phase1" / "corpus-report.md")
    args = ap.parse_args()

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    lib_of = {d["filename"]: d["library"] for d in manifest["documents"]}
    title_of = {d["filename"]: d["title"] for d in manifest["documents"]}
    by_doc: dict[str, list[dict]] = defaultdict(list)
    for line in args.chunks.read_text(encoding="utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            by_doc[r["documentName"]].append(r)

    docs = []
    for name, rows in sorted(by_doc.items()):
        s = doc_stats(rows)
        docs.append({"documentName": name, "library": lib_of.get(name, "?"), "title": title_of.get(name, name), **s, "verdict": verdict(s)})

    libs: dict[str, dict] = defaultdict(lambda: {"docs": 0, "chunks": 0, "ok": 0, "pdf": 0})
    for d in docs:
        L = libs[d["library"]]
        L["docs"] += 1
        L["chunks"] += d["chunks"]
        L["ok"] += d["verdict"] == "ok"
        L["pdf"] += d["documentName"].endswith(".pdf")

    total_docs = len(docs)
    total_chunks = sum(d["chunks"] for d in docs)
    ok_docs = sum(d["verdict"] == "ok" for d in docs)
    pdfs = sum(d["documentName"].endswith(".pdf") for d in docs)
    lines = [
        "# Corpus quality report",
        "",
        f"Chunks file: `{args.chunks.relative_to(ROOT) if args.chunks.is_relative_to(ROOT) else args.chunks}`  ",
        f"Documents: **{total_docs}** ({pdfs} PDFs, {100 * pdfs // max(1, total_docs)}%), chunks: **{total_chunks}**, "
        f"documents passing all heuristics: **{ok_docs}/{total_docs}**",
        "",
        "## Per library",
        "",
        "| library | docs | ok | PDFs | chunks |",
        "|---|---|---|---|---|",
    ]
    for lib, L in sorted(libs.items()):
        lines.append(f"| {lib} | {L['docs']} | {L['ok']} | {L['pdf']} | {L['chunks']} |")
    lines += ["", "## Per document", "", "| document | library | chunks | chars | alpha | short lines | mean chunk | verdict |", "|---|---|---|---|---|---|---|---|"]
    for d in docs:
        lines.append(
            f"| {d['documentName']} | {d['library']} | {d['chunks']} | {d['chars']} | {d['alpha_ratio']} | "
            f"{d['short_line_ratio']} | {d['mean_chunk_chars']} | {d['verdict']} |"
        )
    flagged = [d for d in docs if d["verdict"] != "ok"]
    lines += ["", "## Flagged", ""]
    lines += [f"- `{d['documentName']}` ({d['library']}): {d['verdict']}" for d in flagged] or ["- none"]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines[:6]))
    print(f"flagged: {len(flagged)}")
    for d in flagged:
        print(f"  {d['verdict']:22s} {d['library']}/{d['documentName']}")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
