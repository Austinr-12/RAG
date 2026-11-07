"""The filter chain that decides which teacher outputs become training data.

Every rejection is counted by reason, and the counts are written next to the
dataset. A filter that rejects nothing is suspicious; one that rejects most
candidates points at a prompt problem. Both numbers belong in the dataset card.

Order matters: the first failing check names the rejection, so cheap format
checks run before grounding checks, and dedup runs last over the survivors.

Repairs (``repair_example``) run before the checks. The teacher's citations
are often one edit away from valid: a shortened document title, a quote with a
trailing ellipsis, a lower-cased first word, curly quotation marks, a stray
wrapping mark. Training on the near miss would teach the student the near
miss, so each one is either rewritten to the exact source name and the exact
source span, or left for the filter to reject. Every repair is counted by kind
and stored on the example (``reference["repairs"]``) so the dataset card can
report how much of the teacher's output needed touching.
"""

from __future__ import annotations

import difflib
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Iterable, Sequence

from .contract import Contract, scan_citations, strip_wrapping_quotes
from .teacher import Example, canonical_abstention

# Why an estimate: the exact Qwen token count needs the tokenizer, which is a
# training-time dependency. 3.2 chars/token is conservative for English prose
# with markdown; the trainer drops anything that still exceeds max_length.
CHARS_PER_TOKEN = 3.2
MAX_TOKENS = 3072
MAX_CHARS = int(MAX_TOKENS * CHARS_PER_TOKEN)

# Repair thresholds. A cited name shorter than MIN_NAME_CHARS is never
# resolved by substring (too easy to hit the wrong document). An ellipsis
# segment shorter than MIN_SEGMENT_CHARS is not worth keeping as the quote. A
# fuzzy span must match the quote at FUZZY_MIN_RATIO (difflib ratio) or better.
MIN_NAME_CHARS = 4
MIN_SEGMENT_CHARS = 20
FUZZY_MIN_RATIO = 0.9
# A quote may start in the gold chunk and run past its edge into the
# overlapping neighbor chunk (the app's chunks share 200 characters). It still
# counts as citing the gold chunk when it shares at least this long a run.
BOUNDARY_RUN_CHARS = 40


@dataclass
class FilterStats:
    total: int = 0
    kept: int = 0
    rejected: Counter = field(default_factory=Counter)
    rejected_by_type: dict[str, Counter] = field(default_factory=dict)
    repairs: Counter = field(default_factory=Counter)
    repaired: int = 0
    repaired_kept: int = 0

    def record(self, ex: Example, reason: str | None, repairs: Sequence[dict] = ()) -> None:
        self.total += 1
        if reason is None:
            self.kept += 1
        else:
            self.rejected[reason] += 1
            self.rejected_by_type.setdefault(ex.type, Counter())[reason] += 1
        if repairs:
            self.repaired += 1
            if reason is None:
                self.repaired_kept += 1
            for r in repairs:
                self.repairs[r["kind"]] += 1

    def to_dict(self) -> dict:
        return {
            "candidates": self.total,
            "kept": self.kept,
            "kept_rate": round(self.kept / self.total, 4) if self.total else None,
            "rejected": {k: {"count": v, "rate": round(v / self.total, 4)} for k, v in self.rejected.most_common()},
            "rejected_by_type": {t: dict(c.most_common()) for t, c in sorted(self.rejected_by_type.items())},
            "repairs": {
                "examples": self.repaired,
                "examples_kept": self.repaired_kept,
                "by_kind": dict(self.repairs.most_common()),
            },
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


def _shared_run(a: str, b: str) -> int:
    """Length of the longest substring ``a`` and ``b`` have in common."""
    if not a or not b:
        return 0
    return difflib.SequenceMatcher(None, a, b, autojunk=False).find_longest_match(0, len(a), 0, len(b)).size


def _golds_cited(contract: Contract, ex: Example, cites: list[dict]) -> bool:
    """Every gold chunk must be quoted by at least one valid citation: the
    quote is inside the gold text, or it names the gold document and runs
    from the gold text across the chunk edge into the neighbor chunk."""
    valid = [(c["documentName"], _flatten(strip_wrapping_quotes(contract, c["quote"]))) for c in cites if c["valid"]]
    for g in ex.gold:
        text = _flatten(g.get("normalized", ""))
        if any(q and q in text for _, q in valid):
            continue
        gold_names = {s["documentName"] for s in ex.sources if _flatten(s.get("normalized") or s["content"]) == text}
        if any(n in gold_names and _shared_run(q, text) >= min(len(q), BOUNDARY_RUN_CHARS) for n, q in valid if q):
            continue
        return False
    return True


# -- repairs ------------------------------------------------------------------

_ELLIPSIS_SPLIT_RE = re.compile(r"\s*(?:\.{3,}|…)\s*")
_EDGE_ELLIPSIS_RE = re.compile(r"^(?:\.{3,}|…)\s*|\s*(?:\.{3,}|…)$")
_TRAILING_PUNCT = ".,;:!?"
_OPENING_MARKS = "\"'“‘«‹"
_CLOSING_MARKS = "\"'”’»›"
# Every quotation mark, single or double, straight or curly, becomes one
# symbol: the teacher writes 'United States work' for a source's
# “United States work”, and apostrophes map consistently on both sides.
_LOOSE_MAP: dict[int, str] = {
    **{ord(c): "'" for c in "\"“”«»„‘’‚`´"},
    **{ord(c): "-" for c in "‐‑‒–—―"},
}


def _loose(text: str) -> str:
    """Lower-cased text with quotation marks and dashes unified. Exactly one
    output character per input character, so an index into the loose text is
    an index into the original and the exact-case span can be read back."""
    out = []
    for ch in text:
        ch = _LOOSE_MAP.get(ord(ch), ch)
        low = ch.lower()
        out.append(low if len(low) == 1 else ch)
    return "".join(out)


def _found(quote: str, texts: Sequence[str]) -> bool:
    return bool(quote) and any(quote in t for t in texts)


def _find_loose(quote: str, texts: Sequence[str]) -> str | None:
    """The exact-case span of a text that equals ``quote`` up to case,
    quotation-mark style and dash style."""
    lq = _loose(quote)
    if not lq:
        return None
    for t in texts:
        i = _loose(t).find(lq)
        if i >= 0:
            return t[i : i + len(lq)]
    return None


def _edges_agree(lq: str, lspan: str) -> bool:
    """The span must start and end on roughly the quote's first and last
    words; otherwise the alignment slid onto a page marker or a chunk edge."""
    qw, sw = lq.split(), lspan.split()
    if not qw or not sw:
        return False
    first = difflib.SequenceMatcher(None, qw[0], sw[0], autojunk=False).ratio()
    last = difflib.SequenceMatcher(None, qw[-1], sw[-1], autojunk=False).ratio()
    return first >= 0.6 and last >= 0.6


def _mid_word(text: str, i: int) -> bool:
    """True when position ``i`` splits a word of ``text`` (non-space on both sides)."""
    return 0 < i < len(text) and not text[i - 1].isspace() and not text[i].isspace()


def _fuzzy_span(quote: str, texts: Sequence[str]) -> str | None:
    """The source span the quote was almost certainly copied from.

    Two candidates per text, best score wins: the window of the quote's length
    aligned on the longest shared run and widened to whole words (accepted
    when it agrees with the quote at FUZZY_MIN_RATIO and starts and ends on the
    quote's own words), else the shared run itself trimmed to whole words
    (accepted when it covers three quarters of the quote: the rest was a page
    marker, a chunk edge or a word the source does not have). The result may
    exceed the length limit; ``repair_example`` shortens it afterwards."""
    lq = _loose(quote)
    if len(lq) < MIN_SEGMENT_CHARS:
        return None
    best: tuple[float, str] | None = None

    def offer(score: float, span: str) -> None:
        nonlocal best
        span = span.strip()
        if span and (best is None or score > best[0]):
            best = (score, span)

    for t in texts:
        lt = _loose(t)
        sm = difflib.SequenceMatcher(None, lt, lq, autojunk=False)
        m = sm.find_longest_match(0, len(lt), 0, len(lq))
        if m.size < max(12, len(lq) // 4):
            continue
        start = max(0, m.a - m.b)
        end = min(len(lt), start + len(lq))
        while start > 0 and not lt[start - 1].isspace():
            start -= 1
        while end < len(lt) and not lt[end].isspace():
            end += 1
        lspan = lt[start:end].strip()
        ratio = difflib.SequenceMatcher(None, lq, lspan, autojunk=False).ratio()
        if ratio >= FUZZY_MIN_RATIO and _edges_agree(lq, lspan):
            offer(ratio, t[start:end])
        if m.size >= max(MIN_SEGMENT_CHARS, int(0.75 * len(lq))):
            s, e = m.a, m.a + m.size
            if _mid_word(lt, s) or _mid_word(lq, m.b):
                while s < e and not lt[s].isspace():
                    s += 1
            if _mid_word(lt, e) or _mid_word(lq, m.b + m.size):
                while e > s and not lt[e - 1].isspace():
                    e -= 1
            if e - s >= MIN_SEGMENT_CHARS:
                offer(m.size / len(lq), t[s:e])
    return best[1] if best else None


def _loose_name(name: str) -> str:
    """Case-folded letters and digits only, so "Alice's Adventures in
    Wonderland" is found inside gutenberg-11-alices-adventures-in-wonderland.txt."""
    return "".join(ch for ch in name.casefold() if ch.isalnum())


def resolve_document_name(cited: str, names: Sequence[str]) -> tuple[str | None, str | None]:
    """Map a cited document name onto one of the provided source names.

    Returns ``(name, kind)``: ``kind`` is None for an exact match,
    ``"document_name_case"`` when only letter case or spacing differed,
    ``"document_name_partial"`` when, ignoring case and punctuation, the cited
    name is a unique substring of one source name (the teacher wrote the book
    title instead of the filename, or dropped an author, an extension or a
    part label) or uniquely contains one source name, and
    ``"document_name_fuzzy"`` when the cited name is within a small edit of
    exactly one source name (a wrong circular number). ``(None, None)`` when
    nothing resolves unambiguously. A resolved name is only as good as the
    quote check that follows it: the quote must then be verbatim in that
    document, or the example is rejected anyway.
    """
    if cited in names:
        return cited, None
    c = _flatten(cited).casefold()
    same = [n for n in names if _flatten(n).casefold() == c]
    if len(same) == 1:
        return same[0], "document_name_case"
    lc = _loose_name(cited)
    if len(lc) < MIN_NAME_CHARS:
        return None, None
    loose = [(n, _loose_name(n)) for n in names]
    inside = [n for n, f in loose if lc in f]
    if len(inside) == 1:
        return inside[0], "document_name_partial"
    around = [n for n, f in loose if len(f) >= MIN_NAME_CHARS and f in lc]
    if len(around) == 1:
        return around[0], "document_name_partial"
    close = [n for n, f in loose if difflib.SequenceMatcher(None, lc, f, autojunk=False).ratio() >= FUZZY_MIN_RATIO]
    if len(close) == 1:
        return close[0], "document_name_fuzzy"
    return None, None


_HINT_WORD_RE = re.compile(r"[^\W_]{3,}")


def _hint_tokens(text: str) -> set[str]:
    return set(_HINT_WORD_RE.findall(text.casefold()))


def _overlap(segment: str, hint: set[str]) -> float:
    """Share of the segment's words that also appear in the hint."""
    words = _hint_tokens(segment)
    return len(words & hint) / len(words) if words else 0.0


def repair_quote(contract: Contract, quote: str, texts: Sequence[str], hint: str = "") -> tuple[str, str] | None:
    """Turn a near-miss quote into the exact span of one of ``texts``
    (flattened source texts of the cited document).

    Returns ``(exact_quote, kind)`` or None when the quote is already verbatim
    or cannot be repaired. Kinds, in the order tried: ``quote_unwrapped``
    (wrapping or stray quotation marks), ``quote_trimmed`` (edge ellipsis or
    trailing punctuation), ``quote_normalized`` (case, quotation-mark or dash
    style), ``quote_segment`` (one verbatim part of a quote stitched with
    ellipses: the part that shares the most words with ``hint``, the gold span
    and answer text, longest first on a tie), ``quote_fuzzy`` (a small edit;
    the aligned source span). ``repair_example`` adds ``quote_shortened`` for a
    verbatim quote over the length limit (see ``shorten_quote``).
    """
    original = _flatten(quote)
    if _found(original, texts):
        return None
    unwrapped = _flatten(strip_wrapping_quotes(contract, quote))
    edge = unwrapped.lstrip(_OPENING_MARKS).rstrip(_CLOSING_MARKS).strip()
    trimmed = _EDGE_ELLIPSIS_RE.sub("", edge).rstrip(_TRAILING_PUNCT).strip()
    for cand, kind in ((unwrapped, "quote_unwrapped"), (edge, "quote_unwrapped"), (trimmed, "quote_trimmed")):
        if cand and cand != original and _found(cand, texts):
            return cand, kind
    loose = _find_loose(trimmed, texts)
    if loose:
        return loose, "quote_normalized"
    parts = [p.strip(_OPENING_MARKS + _CLOSING_MARKS + " " + _TRAILING_PUNCT) for p in _ELLIPSIS_SPLIT_RE.split(edge)]
    parts = [p for p in parts if len(p) >= MIN_SEGMENT_CHARS]
    if len(parts) > 1 or (parts and parts[0] != trimmed):
        hint_words = _hint_tokens(hint)
        parts.sort(key=lambda p: (_overlap(p, hint_words), len(p)), reverse=True)
        for p in parts:
            if _found(p, texts):
                return p, "quote_segment"
            hit = _find_loose(p, texts) or _fuzzy_span(p, texts)
            if hit:
                return hit, "quote_segment"
    span = _fuzzy_span(trimmed, texts)
    if span:
        return span, "quote_fuzzy"
    return None


def shorten_quote(quote: str, max_chars: int, hint: str = "") -> str | None:
    """The best whole-word window of a verbatim quote that is longer than
    ``max_chars``: the window that keeps the most words of ``hint`` (the gold
    span and answer text), the longest on a tie. None when no word fits."""
    words = quote.split(" ")
    hint_words = _hint_tokens(hint)
    best: tuple[tuple[int, int], str] | None = None
    for i in range(len(words)):
        j, length = i, -1
        while j < len(words) and length + 1 + len(words[j]) <= max_chars:
            length += 1 + len(words[j])
            j += 1
        if j == i:
            continue
        cand = " ".join(words[i:j])
        key = (len(_hint_tokens(cand) & hint_words), len(cand))
        if best is None or key > best[0]:
            best = (key, cand)
    return best[1] if best else None


def repair_example(contract: Contract, ex: Example) -> list[dict]:
    """Rewrite near-miss citation lines in ``ex.target`` to the exact source
    name and the exact source span. Abstentions are left alone (a citation
    there is a real error, and the filter rejects it). Returns the repairs,
    each ``{"kind", "from", "to"}``, and stores them in
    ``ex.reference["repairs"]``. Anything that does not resolve is left for
    ``check_example`` to reject under its usual reason. A citation line the
    teacher indented under a bullet is moved to the start of the line
    (``citation_dedented``), which is where the app's pattern wants it.
    """
    if not ex.answerable or not ex.target:
        return []
    pattern = contract.citation_pattern
    names = list(dict.fromkeys(s["documentName"] for s in ex.sources))
    # What the quote is supposed to support: the generator's gold span(s) and
    # the teacher's own answer prose. Used to pick between ellipsis segments.
    spans = " ".join(str(ex.reference.get(k) or "") for k in ("answer_span", "answer_span_a", "answer_span_b"))
    prose = " ".join(l for l in ex.target.split("\n") if not l.lstrip().startswith(">"))
    hint = f"{spans} {prose}"
    repairs: list[dict] = []
    out: list[str] = []
    for raw_line in ex.target.split("\n"):
        line = raw_line.rstrip()
        m = pattern.match(line) if line.lstrip().startswith(">") else None
        if not m and line.lstrip().startswith(">") and line != line.lstrip():
            m = pattern.match(line.lstrip())
            if m:
                repairs.append({"kind": "citation_dedented", "from": line, "to": line.lstrip()})
                line = line.lstrip()
        if not m:
            out.append(raw_line)
            continue
        name, quote = m.group(1), m.group(2)
        new_name, kind = resolve_document_name(name, names)
        if new_name is None:
            out.append(raw_line)
            continue
        if kind:
            repairs.append({"kind": kind, "from": name, "to": new_name})
        texts = [_flatten(s.get("normalized") or s["content"]) for s in ex.sources if s["documentName"] == new_name]
        new_quote = quote
        fixed = repair_quote(contract, quote, texts, hint)
        if fixed:
            new_quote, qkind = fixed
            repairs.append({"kind": qkind, "from": quote, "to": new_quote})
        flat_q = _flatten(strip_wrapping_quotes(contract, new_quote))
        if len(flat_q) > contract.max_quote_chars and _found(flat_q, texts):
            short = shorten_quote(flat_q, contract.max_quote_chars, hint)
            if short:
                repairs.append({"kind": "quote_shortened", "from": new_quote, "to": short})
                new_quote = short
        if new_name != name or new_quote != quote or line != raw_line.rstrip():
            out.append(line[: m.start(1)] + new_name + line[m.end(1) : m.start(2)] + new_quote + line[m.end(2) :])
        else:
            out.append(raw_line)
    if repairs:
        ex.target = "\n".join(out)
        ex.reference.setdefault("repairs", []).extend(repairs)
    return repairs


# -- dedup --------------------------------------------------------------------

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
