"""Re-score generation eval JSONL files with the current contract rule.

    python scripts/rescore.py results/phase0/*.jsonl
    python scripts/rescore.py results/phase0/generation-gpt-4o-mini.jsonl --skip q1-pro-price

The app's eval-generation script records each reply with the sources it was
given, so any later change to the citation rule can be applied to old runs
without calling a model again. Prints, per file: format compliance, strict
and lenient citation precision, replies with at least one valid citation,
abstentions, and latency medians. This is the Phase 2 metric set in miniature;
the full version with bootstrap intervals lives in ragft/metrics (Phase 2).
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ragft.contract import load_contract, scan_citations  # noqa: E402


def score(path: Path, skip: set[str]) -> dict:
    contract = load_contract()
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    rows = [r for r in rows if r.get("id") not in skip]
    n = len(rows)
    compliant = 0
    cites_total = cites_lenient = cites_strict = 0
    replies_with_valid = 0
    abstain = 0
    ttft, total = [], []
    for r in rows:
        sources = [{"documentName": s["documentName"], "content": s.get("normalized") or s.get("content", "")} for s in r["sources"]]
        scan = scan_citations(contract, r["output"], sources)
        if scan["malformedCount"] == 0:
            compliant += 1
        cs = scan["citations"]
        cites_total += len(cs)
        cites_lenient += sum(1 for c in cs if c["valid"])
        cites_strict += sum(1 for c in cs if c["valid"] and c["verbatimStrict"])
        if any(c["valid"] for c in cs):
            replies_with_valid += 1
        if not cs:
            abstain += 1
        if r.get("ttftMs") is not None:
            ttft.append(r["ttftMs"])
        if r.get("latencyMs") is not None:
            total.append(r["latencyMs"])
    pct = lambda a, b: (100.0 * a / b) if b else float("nan")  # noqa: E731
    return {
        "file": path.name,
        "provider": rows[0].get("modelId") if rows else None,
        "contract_sha256": contract.sha256,
        "n": n,
        "format_compliant_pct": pct(compliant, n),
        "citations": cites_total,
        "citation_precision_lenient_pct": pct(cites_lenient, cites_total),
        "citation_precision_strict_pct": pct(cites_strict, cites_total),
        "replies_with_valid_citation_pct": pct(replies_with_valid, n),
        "replies_without_citation": abstain,
        "ttft_ms_median": statistics.median(ttft) if ttft else None,
        "latency_ms_median": statistics.median(total) if total else None,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+", type=Path)
    ap.add_argument("--skip", action="append", default=[], help="question id to exclude (repeatable)")
    ap.add_argument("--json", type=Path, help="write the table as JSON here")
    args = ap.parse_args()
    results = [score(p, set(args.skip)) for p in args.files]
    keys = ["n", "format_compliant_pct", "citations", "citation_precision_lenient_pct",
            "citation_precision_strict_pct", "replies_with_valid_citation_pct", "replies_without_citation",
            "ttft_ms_median", "latency_ms_median"]
    print(f"contract {results[0]['contract_sha256'][:12]}  skipped ids: {sorted(args.skip) or 'none'}")
    print(f"{'metric':36s}" + "".join(f"{r['provider'] or r['file']:>26s}" for r in results))
    for k in keys:
        cells = []
        for r in results:
            v = r[k]
            cells.append(f"{v:26.1f}" if isinstance(v, float) else f"{str(v):>26s}")
        print(f"{k:36s}" + "".join(cells))
    if args.json:
        args.json.write_text(json.dumps(results, indent=2), encoding="utf-8")
        print(f"wrote {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
