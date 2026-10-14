"""Download the Phase 1 corpus described by data/corpus-manifest.json.

    python scripts/fetch_corpus.py              # fetch everything missing (resumable)
    python scripts/fetch_corpus.py --check      # only report what is present / missing
    python scripts/fetch_corpus.py --only tax-help --force --workers 4

Files land in data/raw/<library>/<filename> (gitignored). Every file is
verified: PDFs must start with %PDF, text must be mostly printable, and
everything must be larger than a stub. A JSON report with sizes, sha256 and
failures is written to data/raw/fetch-report.json so the dataset card can
cite exactly what was used.

Why a manifest plus a script instead of committing the documents: the raw
files are tens of megabytes and belong on the HF Hub with the dataset; the
manifest is the reproducible recipe and carries the license of every source.
Downloads run in parallel because some government hosts are slow and one
stalled URL must not hold up the other ninety.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "data" / "corpus-manifest.json"
RAW = ROOT / "data" / "raw"
REPORT = RAW / "fetch-report.json"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
MIN_BYTES = 2_000
TIMEOUT_S = 30
ATTEMPTS = 2


def wikipedia_url(title: str) -> str:
    q = urllib.parse.urlencode(
        {
            "action": "query",
            "prop": "extracts",
            "explaintext": "1",
            "exsectionformat": "plain",
            "redirects": "1",
            "format": "json",
            "formatversion": "2",
            "titles": title,
        }
    )
    return f"https://en.wikipedia.org/w/api.php?{q}"


def fetch_bytes(url: str) -> bytes:
    last: Exception | None = None
    for i in range(ATTEMPTS):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
                return resp.read()
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:  # noqa: PERF203
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"download failed after {ATTEMPTS} attempts: {last}")


def wikipedia_text(payload: bytes, title: str) -> bytes:
    data = json.loads(payload.decode("utf-8"))
    page = data["query"]["pages"][0]
    if page.get("missing"):
        raise RuntimeError(f"wikipedia page missing: {title}")
    extract = page.get("extract", "").strip()
    if not extract:
        raise RuntimeError(f"wikipedia extract empty: {title}")
    real = page.get("title", title)
    slug = urllib.parse.quote(real.replace(" ", "_"))
    header = f"{real}\n\nSource: https://en.wikipedia.org/wiki/{slug}\nLicense: CC BY-SA 4.0\n\n"
    return (header + extract + "\n").encode("utf-8")


def looks_like_text(blob: bytes) -> bool:
    sample = blob[:20_000]
    try:
        text = sample.decode("utf-8")
    except UnicodeDecodeError:
        return False
    printable = sum(ch.isprintable() or ch in "\n\r\t" for ch in text)
    return printable / max(1, len(text)) > 0.97


def verify(entry: dict, blob: bytes) -> str | None:
    """Return a failure reason, or None when the file is acceptable."""
    if len(blob) < MIN_BYTES:
        return f"too small ({len(blob)} bytes)"
    if entry["kind"] == "pdf":
        if not blob.startswith(b"%PDF"):
            return "not a PDF (no %PDF header; probably an HTML error page)"
    else:
        if not looks_like_text(blob):
            return "not clean text"
        if re.search(rb"<!DOCTYPE html|<html", blob[:2000], re.I):
            return "HTML page instead of text"
    return None


def split_text(blob: bytes, parts: int) -> list[bytes]:
    """Split text into `parts` pieces of similar size at paragraph boundaries."""
    text = blob.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")
    target = len(text) / parts

    def pack(units: list[str], glue: str) -> list[str]:
        out: list[str] = []
        current: list[str] = []
        size = 0
        for unit in units:
            current.append(unit)
            size += len(unit) + len(glue)
            if size >= target and len(out) < parts - 1:
                out.append(glue.join(current))
                current, size = [], 0
        if current:
            out.append(glue.join(current))
        return out

    pieces = pack(text.split("\n\n"), "\n\n")
    if len(pieces) < parts:
        pieces = pack(text.split("\n"), "\n")
    if len(pieces) < parts:
        step = -(-len(text) // parts)
        pieces = [text[i : i + step] for i in range(0, len(text), step)]
    if len(pieces) != parts:
        raise RuntimeError(f"could not split into {parts} parts (got {len(pieces)})")
    return [piece.encode("utf-8") for piece in pieces]


def process(entry: dict, *, check: bool, force: bool) -> tuple[dict | None, dict | None, str]:
    """Fetch/verify one entry. Returns (document_record, failure_record, log_line)."""
    dest = RAW / entry["library"] / entry["filename"]
    dest.parent.mkdir(parents=True, exist_ok=True)
    url = wikipedia_url(entry["title"]) if entry["kind"] == "wikipedia" else entry["url"]
    label = f"{entry['library']}/{entry['filename']}"
    # Why split_parts: the app caps uploads at 500 chunks per file, so a long
    # book is stored as several files, exactly as a user would upload it.
    parts = int(entry.get("split_parts", 1))

    def part_path(i: int) -> Path:
        if parts == 1:
            return dest
        return dest.with_name(f"{dest.stem}-part{i}of{parts}{dest.suffix}")

    paths = [part_path(i) for i in range(1, parts + 1)]
    status = "present" if all(p.exists() for p in paths) and not force else "missing"
    if status == "missing":
        if check:
            return None, None, f"  missing  {label}"
        try:
            blob = fetch_bytes(url)
            if entry["kind"] == "wikipedia":
                blob = wikipedia_text(blob, entry["title"])
            reason = verify(entry, blob)
            if reason:
                raise RuntimeError(reason)
            if parts > 1:
                for path, piece in zip(paths, split_text(blob, parts)):
                    path.write_bytes(piece)
            else:
                dest.write_bytes(blob)
            status = "fetched"
        except Exception as ex:  # noqa: BLE001
            failure = {"id": entry["id"], "library": entry["library"], "url": url, "reason": str(ex)[:200]}
            return None, failure, f"  FAIL     {label}: {str(ex)[:110]}"
    blob = b"\n\n".join(p.read_bytes() for p in paths)
    reason = verify(entry, blob)
    if reason:
        failure = {"id": entry["id"], "library": entry["library"], "url": url, "reason": reason}
        return None, failure, f"  BAD      {label}: {reason}"
    record = {
        "id": entry["id"],
        "library": entry["library"],
        "filename": entry["filename"],
        "bytes": len(blob),
        "sha256": hashlib.sha256(blob).hexdigest(),
        "license": entry["license"],
        "source": url,
        "status": status,
    }
    return record, None, f"  {status:8s} {label} ({len(blob) // 1024} KB)"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="report only, download nothing")
    ap.add_argument("--only", help="library id to restrict to")
    ap.add_argument("--force", action="store_true", help="re-download even if present")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    entries = [e for e in manifest["documents"] if not args.only or e["library"] == args.only]
    RAW.mkdir(parents=True, exist_ok=True)
    report = {"fetched_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "documents": [], "failures": []}

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(lambda e: process(e, check=args.check, force=args.force), entries))
    for record, failure, line in results:
        print(line)
        if record:
            report["documents"].append(record)
        if failure:
            report["failures"].append(failure)
    if not args.check:
        REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")

    libs: dict[str, int] = {}
    for d in report["documents"]:
        libs[d["library"]] = libs.get(d["library"], 0) + 1
    pdfs = sum(1 for d in report["documents"] if d["filename"].endswith(".pdf"))
    total_mb = sum(d["bytes"] for d in report["documents"]) / 2**20
    print(
        f"\n{len(report['documents'])}/{len(entries)} documents present ({total_mb:.0f} MB), "
        f"{pdfs} PDFs, {len(libs)} libraries, {len(report['failures'])} failures"
    )
    for lib, n in sorted(libs.items()):
        print(f"  {lib:24s} {n}")
    if report["failures"]:
        print("failures:")
        for f in report["failures"]:
            print(f"  {f['id']:28s} {f['reason'][:90]}")
    return 0 if not report["failures"] else 1


if __name__ == "__main__":
    sys.exit(main())
