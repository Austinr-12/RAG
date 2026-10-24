"""Tests for ragft.filters and ragft.split (no network).

    python tests/test_filters_split.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ragft.contract import load_contract  # noqa: E402
from ragft.filters import check_example, dedupe  # noqa: E402
from ragft.split import split_by_library  # noqa: E402
from ragft.teacher import Example, canonical_abstention  # noqa: E402

CONTRACT = load_contract()
DOC = "aurora-notebook-handbook.md"
TEXT = "Every Aurora Notebook is covered by a one-year limited warranty from the date of purchase."
SOURCES = [{"documentName": DOC, "content": TEXT, "normalized": TEXT},
           {"documentName": "faq.txt", "content": "Phone support: 1-800-287-6721.", "normalized": "Phone support: 1-800-287-6721."}]
GOLD = [{"document": DOC, "index": 0, "normalized": TEXT}]


def ex(kind: str, target: str, library: str = "lib1", sources=SOURCES, gold=GOLD, reference=None) -> Example:
    return Example(id="x", type=kind, library=library, name_style="filename", question="How long is the warranty?",
                   sources=sources, gold=gold, reference=reference or {}, target=target)


def test_canonical_abstention_is_first_sentence():
    assert canonical_abstention(CONTRACT) == "I don't have anything about that in your uploaded documents."


def test_valid_single_passes():
    t = f"The warranty lasts one year.\n> **{DOC}** — covered by a one-year limited warranty"
    assert check_example(CONTRACT, ex("single", t)) is None


def test_wrapped_quote_passes_under_lenient_rule():
    t = f'The warranty lasts one year.\n> **{DOC}** — "covered by a one-year limited warranty"'
    assert check_example(CONTRACT, ex("single", t)) is None


def test_single_without_citation_rejected():
    assert check_example(CONTRACT, ex("single", "The warranty lasts one year.")) == "no_citation"


def test_wrong_document_name_rejected():
    t = "One year.\n> **Aurora Handbook** — covered by a one-year limited warranty"
    assert check_example(CONTRACT, ex("single", t)) == "unknown_document_name"


def test_paraphrase_rejected():
    t = f"One year.\n> **{DOC}** — a 12 month warranty applies"
    assert check_example(CONTRACT, ex("single", t)) == "quote_not_verbatim"


def test_citing_other_doc_only_is_gold_not_cited():
    t = "Call support.\n> **faq.txt** — Phone support: 1-800-287-6721."
    assert check_example(CONTRACT, ex("single", t)) == "gold_not_cited"


def test_malformed_line_rejected():
    t = f"One year.\n> **{DOC}** - covered by a one-year limited warranty"
    assert check_example(CONTRACT, ex("single", t)) == "malformed_citation_line"


def test_negative_must_be_canonical_and_uncited():
    good = canonical_abstention(CONTRACT) + " The sources cover support hours."
    assert check_example(CONTRACT, ex("negative", good)) is None
    assert check_example(CONTRACT, ex("negative", "The documents don't say.")) == "abstention_not_canonical"
    bad = canonical_abstention(CONTRACT) + f"\n> **{DOC}** — covered by a one-year limited warranty"
    assert check_example(CONTRACT, ex("negative", bad)) == "abstention_has_citation"


def test_partial_requires_acknowledgement_flags():
    t = f"One year.\n> **{DOC}** — covered by a one-year limited warranty\nThe documents do not mention the battery."
    assert check_example(CONTRACT, ex("partial", t, reference={"answers_covered_part": True, "acknowledges_uncovered_part": False})) == "partial_uncovered_not_acknowledged"
    assert check_example(CONTRACT, ex("partial", t, reference={"answers_covered_part": True, "acknowledges_uncovered_part": True})) is None


def test_too_long_rejected():
    long_sources = [{"documentName": DOC, "content": "x " * 6000, "normalized": "x " * 6000}]
    t = f"Long.\n> **{DOC}** — x x x"
    assert check_example(CONTRACT, ex("single", t, sources=long_sources, gold=[{"document": DOC, "index": 0, "normalized": "x " * 6000}])) == "too_long"


def test_dedupe_drops_near_duplicates_within_document():
    a = ex("single", "t"); a.question = "How long is the warranty period?"
    b = ex("single", "t"); b.question = "How long is the warranty period"
    c = ex("single", "t"); c.question = "What phone number do I call for support?"
    n = ex("negative", "t"); n.question = "How long is the warranty period?"
    kept, dropped = dedupe([a, b, c, n])
    assert dropped == 1 and len(kept) == 3
    assert n in kept  # abstention twin is compared only among abstentions


def test_split_by_library_and_leak_check():
    exs = [ex("single", "t", library="health-guides"), ex("single", "t", library="rust-book"), ex("single", "t", library="tax-help")]
    exs[0].gold = [{"document": "h.pdf", "index": 0, "normalized": ""}]
    exs[1].gold = [{"document": "r.md", "index": 0, "normalized": ""}]
    exs[2].gold = [{"document": "t.pdf", "index": 0, "normalized": ""}]
    s = split_by_library(exs)
    assert [len(s["train"]), len(s["validation"]), len(s["test"])] == [1, 1, 1]
    exs[2].gold = [{"document": "h.pdf", "index": 0, "normalized": ""}]
    try:
        split_by_library(exs)
    except AssertionError as e:
        assert "leak" in str(e)
    else:
        raise AssertionError("leak not detected")


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for test in tests:
        test()
        print(f"ok  {test.__name__}")
    print(f"{len(tests)} passed")
