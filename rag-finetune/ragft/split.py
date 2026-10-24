"""Split examples by library so no document leaks between train, validation
and test. Decided 2026-10-23: test = health-guides + wikipedia-technology
(one PDF library, one text library), validation = rust-book, the rest train.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Iterable

from .teacher import Example

TEST_LIBRARIES = frozenset({"health-guides", "wikipedia-technology"})
VAL_LIBRARIES = frozenset({"rust-book"})


def split_name(library: str) -> str:
    if library in TEST_LIBRARIES:
        return "test"
    if library in VAL_LIBRARIES:
        return "validation"
    return "train"


def split_by_library(examples: Iterable[Example]) -> dict[str, list[Example]]:
    out: dict[str, list[Example]] = {"train": [], "validation": [], "test": []}
    for ex in examples:
        out[split_name(ex.library)].append(ex)
    docs: dict[str, set[str]] = {k: {g["document"] for ex in v for g in ex.gold} for k, v in out.items()}
    for a in docs:
        for b in docs:
            if a < b and docs[a] & docs[b]:
                raise AssertionError(f"document leak between {a} and {b}: {sorted(docs[a] & docs[b])[:3]}")
    return out


def write_splits(splits: dict[str, list[Example]], out_dir: Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    report: dict = {}
    for name, exs in splits.items():
        path = out_dir / f"{name}.jsonl"
        with path.open("w", encoding="utf-8") as fh:
            for ex in exs:
                fh.write(json.dumps(ex.to_json(), ensure_ascii=False) + "\n")
        report[name] = {
            "examples": len(exs),
            "by_type": dict(Counter(ex.type for ex in exs).most_common()),
            "libraries": sorted({ex.library for ex in exs}),
            "file": str(path),
        }
    return report
