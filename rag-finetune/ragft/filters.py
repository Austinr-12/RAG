"""The filter chain that decides which teacher outputs become training data.

Every rejection is counted by reason, and the counts are written next to the
dataset. A filter that rejects nothing is suspicious; one that rejects most
candidates points at a prompt problem. Both numbers belong in the dataset card.

Order matters: the first failing check names the rejection, so cheap format
checks run before grounding checks, and dedup runs last over the survivors.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Iterable

from .contract import Contract, scan_citations, strip_wrapping_quotes
from .teacher import Example, canonical_abstention

# Why an estimate: the exact Qwen token count needs the tokenizer, which is a
# training-time dependency. 3.2 chars/token is conservative for English prose
# with markdown; the trainer drops anything that still exceeds max_length.
CHARS_PER_TOKEN = 3.2
MAX_TOKENS = 3072
MAX_CHARS = int(MAX_TOKENS * CHARS_PER_TOKEN)


@dataclass
class FilterStats:
    total: int = 0
    kept: int = 0
    rejected: Counter = field(default_factory=Counter)
    rejected_by_type: dict[str, Counter] = field(default_factory=dict)

    def record(self, ex: Example, reason: str | None) -> None:
        self.total += 1
        if reason is None:
            self.kept += 1
        else:
            self.rejected[reason] += 1
            self.rejected_by_type.setdefault(ex.type, Counter())[reason] += 1

    def to_dict(self) -> dict:
        return {
            "candidates": self.total,
            "kept": self.kept,
            "kept_rate": round(self.kept / self.total, 4) if self.total else None,
            "rejected": {k: {"count": v, "rate": round(v / self.total, 4)} for k, v in self.rejected.most_common()},
            "rejected_by_type": {t: dict(c.most_common()) for t, c in sorted(self.rejected_by_type.items())},
        }


def _flatten(text: str) -> str:
    return " ".join(text.split())


def _rendered_chars(contract: Contract, ex: Example) -> int:
    return sum(len(m["content"]) for m in ex.messages(contract)) + len(ex.target or "")


def check_example(contract: Contract, ex: Example) -> str | None:
    """Return None when the example passes, else the name of the first failing check."""
    target = (ex.target or "").strip()
    if not target:
        return "empty_target"
    if _rendered_chars(contract, ex) > MAX_CHARS:
        return "too_long"

    scan = scan_citations(contract, target, ex.sources)
    cites = scan["citations"]
    if scan["malformedCount"] > 0:
        return "malformed_citation_line"

    if ex.answerable:
        if not cites:
            return "no_citation"
        for c in cites:
            if not c["knownDocument"]:
                return "unknown_document_name"
            if not c["verbatim"]:
                return "quote_not_verbatim"
            if not c["withinLength"]:
                return "quote_too_long"
        if not _golds_cited(contract, ex, cites):
            return "gold_not_cited"
        if ex.type == "partial":
            ref = ex.reference
            if not ref.get("answers_covered_part", True):
                return "partial_covered_part_missing"
            if not ref.get("acknowledges_uncovered_part", False):
                return "partial_uncovered_not_acknowledged"
        return None

    # Abstentions: negative, multiturn_uncovered, multiturn_empty
    if cites:
        return "abstention_has_citation"
    if ex.type == "multiturn_empty":
        return None if target.startswith(contract.no_sources_reply.strip()[:40]) else "abstention_not_canonical"
    if not target.startswith(canonical_abstention(contract)):
        return "abstention_not_canonical"
    return None


def _golds_cited(contract: Contract, ex: Example, cites: list[dict]) -> bool:
    """Every gold chunk must be quoted by at least one valid citation."""
    quotes = [_flatten(strip_wrapping_quotes(contract, c["quote"])) for c in cites if c["valid"]]
    for g in ex.gold:
        text = _flatten(g.get("normalized", ""))
        if not any(q and q in text for q in quotes):
            return False
    return True


_WORD_RE = re.compile(r"[a-z0-9]+")


def _norm_question(q: str) -> str:
    return " ".join(_WORD_RE.findall(q.lower()))


def _jaccard(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if a or b else 0.0


def dedupe(examples: Iterable[Example], threshold: float = 0.8) -> tuple[list[Example], int]:
    """Drop near-duplicate questions within the same document (exact match
    after normalization, or token Jaccard above the threshold). Returns the
    survivors and the number dropped. Abstention examples share questions with
    their answerable twin on purpose and are compared only among themselves."""
    kept: list[Example] = []
    seen: dict[tuple[str, bool], list[tuple[str, set[str]]]] = {}
    dropped = 0
    for ex in examples:
        doc = ex.gold[0]["document"] if ex.gold else ex.library
        bucket = seen.setdefault((doc, ex.answerable), [])
        norm = _norm_question(ex.question)
        tokens = set(norm.split())
        if any(norm == n or _jaccard(tokens, t) >= threshold for n, t in bucket):
            dropped += 1
            continue
        bucket.append((norm, tokens))
        kept.append(ex)
    return kept, dropped
