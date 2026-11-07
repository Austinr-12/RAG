"""Tests for ragft.filters and ragft.split (no network).

    python tests/test_filters_split.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ragft.contract import load_contract  # noqa: E402
from ragft.filters import FilterStats, check_example, dedupe, repair_example, repair_quote, resolve_document_name, shorten_quote  # noqa: E402
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


# -- repairs ------------------------------------------------------------------

def test_repair_leaves_valid_and_abstention_targets_alone():
    t = f"The warranty lasts one year.\n> **{DOC}** — covered by a one-year limited warranty"
    e = ex("single", t)
    assert repair_example(CONTRACT, e) == [] and e.target == t and "repairs" not in e.reference
    bad = canonical_abstention(CONTRACT) + f"\n> **{DOC}** — covered by a one-year limited warranty..."
    n = ex("negative", bad)
    assert repair_example(CONTRACT, n) == [] and n.target == bad
    assert check_example(CONTRACT, n) == "abstention_has_citation"


def test_repair_document_name_partial_and_case():
    e = ex("single", "One year.\n> **aurora-notebook-handbook** — covered by a one-year limited warranty")
    r = repair_example(CONTRACT, e)
    assert [x["kind"] for x in r] == ["document_name_partial"] and r[0]["to"] == DOC
    assert e.target == f"One year.\n> **{DOC}** — covered by a one-year limited warranty"
    assert e.reference["repairs"] == r
    assert check_example(CONTRACT, e) is None
    e2 = ex("single", "One year.\n> **Aurora-Notebook-Handbook.MD** — covered by a one-year limited warranty")
    assert [x["kind"] for x in repair_example(CONTRACT, e2)] == ["document_name_case"]
    assert check_example(CONTRACT, e2) is None
    assert resolve_document_name("Aurora Notebook Handbook (aurora-notebook-handbook.md)", [DOC]) == (DOC, "document_name_partial")


def test_repair_document_name_refuses_ambiguity_and_strangers():
    srcs = [{"documentName": "a-guide.md", "content": TEXT, "normalized": TEXT},
            {"documentName": "b-guide.md", "content": TEXT, "normalized": TEXT}]
    e = ex("single", "One year.\n> **guide** — covered by a one-year limited warranty", sources=srcs,
           gold=[{"document": "a-guide.md", "index": 0, "normalized": TEXT}])
    assert repair_example(CONTRACT, e) == []
    assert check_example(CONTRACT, e) == "unknown_document_name"
    assert resolve_document_name("Aurora Handbook", [DOC, "faq.txt"]) == (None, None)
    assert resolve_document_name("md", [DOC]) == (None, None)  # too short to trust


def test_repair_quote_unwrapped_trimmed_normalized():
    texts = [TEXT]
    assert repair_quote(CONTRACT, "covered by a one-year limited warranty", texts) is None
    assert repair_quote(CONTRACT, "covered by a one-year limited warranty...", texts) == ("covered by a one-year limited warranty", "quote_trimmed")
    assert repair_quote(CONTRACT, "…covered by a one-year limited warranty.", texts) == ("covered by a one-year limited warranty", "quote_trimmed")
    assert repair_quote(CONTRACT, "“covered by a one-year limited warranty”", texts) == ("covered by a one-year limited warranty", "quote_unwrapped")
    assert repair_quote(CONTRACT, "\"covered by a one-year limited warranty”", texts) == ("covered by a one-year limited warranty", "quote_unwrapped")
    assert repair_quote(CONTRACT, "every Aurora Notebook is covered", texts) == ("Every Aurora Notebook is covered", "quote_normalized")
    assert repair_quote(CONTRACT, "one–year limited warranty", ["a one-year limited warranty"]) == ("one-year limited warranty", "quote_normalized")


def test_repair_document_name_ignores_punctuation_and_fixes_one_wrong_digit():
    names = ["gutenberg-11-alices-adventures-in-wonderland.txt", "gutenberg-16-peter-pan.txt"]
    assert resolve_document_name("Alice's Adventures in Wonderland", names) == (names[0], "document_name_partial")
    assert resolve_document_name("Peter Pan", names) == (names[1], "document_name_partial")
    circ = ["Copyright Office Circular 1: Copyright Basics", "Copyright Office Circular 3: Copyright Notice"]
    assert resolve_document_name("Copyright Office Circular 4: Copyright Basics", circ) == (circ[0], "document_name_fuzzy")
    assert resolve_document_name("Copyright Basics", circ) == (circ[0], "document_name_partial")
    assert resolve_document_name("Copyright Office Circular", circ) == (None, None)  # inside both


def test_repair_quote_segment_and_fuzzy():
    texts = [TEXT]
    assert repair_quote(CONTRACT, "Every Aurora Notebook... from the date of purchase.", texts) == ("from the date of purchase", "quote_segment")
    assert repair_quote(CONTRACT, "covered by a one year limited warranty from the date of purchase", texts) == \
        ("covered by a one-year limited warranty from the date of purchase.", "quote_fuzzy")
    assert repair_quote(CONTRACT, "a 12 month warranty applies", texts) is None
    assert repair_quote(CONTRACT, "Every Aurora... purchase", texts) is None  # segments too short to keep


def test_repair_quote_segment_prefers_the_part_that_matches_the_gold_span():
    texts = [TEXT]
    q = "Every Aurora Notebook is covered... from the date of purchase."
    assert repair_quote(CONTRACT, q, texts) == ("Every Aurora Notebook is covered", "quote_segment")  # longest wins without a hint
    assert repair_quote(CONTRACT, q, texts, hint="from the date of purchase") == ("from the date of purchase", "quote_segment")
    e = ex("single", f"The clock starts at purchase.\n> **{DOC}** — \"{q}\"", reference={"answer_span": "from the date of purchase"})
    r = repair_example(CONTRACT, e)
    assert [x["kind"] for x in r] == ["quote_segment"] and r[0]["to"] == "from the date of purchase"
    assert check_example(CONTRACT, e) is None


def test_repaired_example_passes_and_is_counted():
    t = "One year.\n> **aurora-notebook-handbook** — “covered by a one-year limited warranty...”"
    e = ex("single", t)
    r = repair_example(CONTRACT, e)
    assert [x["kind"] for x in r] == ["document_name_partial", "quote_trimmed"]
    assert e.target == f"One year.\n> **{DOC}** — covered by a one-year limited warranty"
    reason = check_example(CONTRACT, e)
    assert reason is None
    stats = FilterStats()
    stats.record(e, reason, r)
    stats.record(ex("single", "no citation here"), "no_citation")
    d = stats.to_dict()
    assert d["repairs"] == {"examples": 1, "examples_kept": 1, "by_kind": {"document_name_partial": 1, "quote_trimmed": 1}}
    assert d["kept"] == 1 and d["rejected"]["no_citation"]["count"] == 1


def test_repair_keeps_unrepairable_lines_for_the_filter():
    t = f"One year.\n> **{DOC}** — a 12 month warranty applies\n> **Nowhere.pdf** — covered by a one-year limited warranty"
    e = ex("single", t)
    assert repair_example(CONTRACT, e) == [] and e.target == t
    assert check_example(CONTRACT, e) == "quote_not_verbatim"


# -- dedup and split ------------------------------------------------------------

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


def test_repair_quote_unifies_all_quotation_marks_and_fuzzes_each_segment():
    src = "The Copyright Act defines a “United States work” for the purposes of registration as (a) a pub- lished work that is first published in the United States."
    assert repair_quote(CONTRACT, "defines a 'United States work' for the purposes", [src]) == \
        ("defines a “United States work” for the purposes", "quote_normalized")
    q = "The Copyright Act defines a 'United States work'... as (a) a published work that is first published in the United States"
    hint = "a published work that is first published in the United States"
    assert repair_quote(CONTRACT, q, [src], hint) == \
        ("as (a) a pub- lished work that is first published in the United States.", "quote_segment")


def test_shorten_quote_keeps_the_window_with_the_answer_words():
    long_text = " ".join(f"word{i:02d}" for i in range(1, 41))  # 40 words, 279 chars
    short = shorten_quote(long_text, 200, hint="word38 word39 word40")
    assert short is not None and len(short) <= 200 and short in long_text and short.endswith("word40")
    head = shorten_quote(long_text, 200, hint="word01 word02")
    assert head.startswith("word01") and len(head) <= 200
    assert shorten_quote("x" * 300, 200) is None
    doc = "long-doc.txt"
    srcs = [{"documentName": doc, "content": long_text, "normalized": long_text}]
    e = ex("single", f"The last word is word40.\n> **{doc}** — {long_text}", sources=srcs,
           gold=[{"document": doc, "index": 0, "normalized": long_text}], reference={"answer_span": "word40"})
    r = repair_example(CONTRACT, e)
    assert [x["kind"] for x in r] == ["quote_shortened"] and r[0]["to"].endswith("word40")
    assert check_example(CONTRACT, e) is None


def test_gold_counts_as_cited_when_the_quote_runs_into_the_neighbor_chunk():
    doc = "gutenberg-132-the-art-of-war.txt"
    gold_text = "Alas for these brave words! The long feud between the two states ended in 473 B.C. with the total defeat of Wu by Kou Chien and its"
    neighbor = "The long feud between the two states ended in 473 B.C. with the total defeat of Wu by Kou Chien and its incorporation in Yueh. This was doubtless long after."
    far = "The Martians are able to discharge enormous clouds of a black and poisonous vapour by means of rockets."
    srcs = [{"documentName": doc, "content": gold_text, "normalized": gold_text},
            {"documentName": doc, "content": neighbor, "normalized": neighbor},
            {"documentName": doc, "content": far, "normalized": far}]
    gold = [{"document": doc, "index": 193, "normalized": gold_text}]
    spanning = f"In 473 B.C.\n> **{doc}** — The long feud between the two states ended in 473 B.C. with the total defeat of Wu by Kou Chien and its incorporation in Yueh"
    assert check_example(CONTRACT, ex("single", spanning, sources=srcs, gold=gold)) is None
    elsewhere = f"Rockets.\n> **{doc}** — The Martians are able to discharge enormous clouds of a black and poisonous vapour by means of rockets."
    assert check_example(CONTRACT, ex("single", elsewhere, sources=srcs, gold=gold)) == "gold_not_cited"


def test_fuzzy_span_does_not_slide_onto_page_markers_or_chunk_edges():
    # the chunk starts mid-word: the quoted sentence begins in the previous chunk
    chunk = "u suspect that the heating system may be contaminated with mold (it is part of a bigger problem), consult the guide."
    assert repair_quote(CONTRACT, "If you suspect that the heating system may be contaminated with mold", [chunk]) == \
        ("suspect that the heating system may be contaminated with mold", "quote_fuzzy")
    # a page footer sits inside the sentence the teacher quoted
    page = "The molten rock -- 1 of 9 -- (magma) rises to the surface from as deep as tens of kilometers and erupts to form volcanoes."
    assert repair_quote(CONTRACT, "molten rock (magma) rises to the surface from as deep as tens of kilometers and erupts to form volcanoes.", [page]) == \
        ("(magma) rises to the surface from as deep as tens of kilometers and erupts to form volcanoes.", "quote_fuzzy")
    # a real paraphrase still fails
    assert repair_quote(CONTRACT, "magma comes up from very deep and makes volcanoes", [page]) is None


def test_fuzzy_repair_over_the_length_limit_is_then_shortened():
    doc = "nhlbi-dash-eating-plan-guide.pdf"
    src = ("Menus and recipes were analyzed using the Minnesota Nutrition Data System software—Food Data Base version "
           "NDS-R 2005— developed by the Nutrition Coordinating Center, University of Minnesota, Minneapolis.")
    quote = src.replace("2005— developed", "2005—developed")  # one space short of verbatim, 206 chars
    assert len(quote) > 200
    srcs = [{"documentName": doc, "content": src, "normalized": src}]
    e = ex("single", f"In Minneapolis.\n> **{doc}** — \"{quote}\"", sources=srcs,
           gold=[{"document": doc, "index": 0, "normalized": src}], reference={"answer_span": "University of Minnesota, Minneapolis"})
    r = repair_example(CONTRACT, e)
    assert [x["kind"] for x in r] == ["quote_fuzzy", "quote_shortened"]
    assert r[1]["to"].endswith("Minneapolis.") and len(r[1]["to"]) <= 200
    assert check_example(CONTRACT, e) is None


def test_indented_citation_line_is_dedented():
    t = f"- The warranty lasts one year.\n  > **{DOC}** — covered by a one-year limited warranty"
    e = ex("single", t)
    assert check_example(CONTRACT, ex("single", t)) == "malformed_citation_line"
    r = repair_example(CONTRACT, e)
    assert [x["kind"] for x in r] == ["citation_dedented"]
    assert e.target == f"- The warranty lasts one year.\n> **{DOC}** — covered by a one-year limited warranty"
    assert check_example(CONTRACT, e) is None


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for test in tests:
        test()
        print(f"ok  {test.__name__}")
    print(f"{len(tests)} passed")
