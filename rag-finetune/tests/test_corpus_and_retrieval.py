"""Tests for ragft.corpus and ragft.retrieval_sim on a synthetic corpus.

Run with either:
    python -m pytest tests/test_corpus_and_retrieval.py
    python tests/test_corpus_and_retrieval.py
"""

from __future__ import annotations

import json
import random
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ragft.corpus import Corpus, manifest_filename  # noqa: E402
from ragft.retrieval_sim import (  # noqa: E402
    BM25,
    LibraryIndex,
    answerable_context,
    choose_k,
    negative_context,
    render_sources,
    tokenize,
)

TOPICS = {
    "warranty": "The warranty lasts one year from purchase and covers manufacturing defects.",
    "battery": "The battery is rated for one thousand charge cycles before capacity drops.",
    "support": "Phone support is available weekdays at 1-800-287-6721 from eight to eight.",
    "recycling": "Recycle the device at any certified electronics recycler free of charge.",
    "encryption": "Full-disk encryption is enabled by default and cannot be disabled.",
    "display": "The display measures sixteen inches and refreshes at one hundred twenty hertz.",
}


def _synthetic(tmp: Path) -> tuple[Path, Path]:
    manifest = {
        "documents": [
            {"id": "a", "library": "lib1", "title": "Aurora Handbook", "filename": "aurora.md", "license": "x", "kind": "md"},
            {"id": "b", "library": "lib1", "title": "Support FAQ", "filename": "faq.txt", "license": "x", "kind": "txt"},
            {"id": "c", "library": "lib2", "title": "Big Book", "filename": "book.txt", "license": "x", "kind": "txt"},
        ]
    }
    rows = []
    for name, keys in (("aurora.md", ["warranty", "battery", "encryption", "display"]), ("faq.txt", ["support", "recycling"])):
        for i, key in enumerate(keys):
            text = f"Section {i}. {TOPICS[key]} Filler sentence {i} about nothing in particular."
            rows.append({"documentName": name, "chunkIndex": i, "chunkCount": len(keys), "content": text, "normalized": text})
    for part in (1, 2):
        for i in range(3):
            text = f"Book part {part} chunk {i}: chapter text about history and voyages number {i}."
            rows.append({"documentName": f"book-part{part}of2.txt", "chunkIndex": i, "chunkCount": 3, "content": text, "normalized": text})
    chunks = tmp / "chunks.jsonl"
    chunks.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")
    man = tmp / "manifest.json"
    man.write_text(json.dumps(manifest), encoding="utf-8")
    return chunks, man


def _corpus() -> Corpus:
    tmp = Path(tempfile.mkdtemp())
    chunks, man = _synthetic(tmp)
    return Corpus.load(chunks, man)


def test_part_filenames_map_to_manifest_entry():
    assert manifest_filename("book-part2of2.txt") == "book.txt"
    assert manifest_filename("aurora.md") == "aurora.md"


def test_corpus_groups_documents_and_libraries():
    c = _corpus()
    assert set(c.libraries) == {"lib1", "lib2"}
    assert sorted(d.filename for d in c.libraries["lib1"]) == ["aurora.md", "faq.txt"]
    assert sorted(d.filename for d in c.libraries["lib2"]) == ["book-part1of2.txt", "book-part2of2.txt"]
    assert c.summary()["chunks"] == 12
    assert c.documents["book-part2of2.txt"].display_name("title") == "Big Book (part 2 of 2)"
    assert c.documents["aurora.md"].display_name("filename") == "aurora.md"


def test_neighbors_are_adjacent_indexes_only():
    c = _corpus()
    doc = c.documents["aurora.md"]
    mid = doc.chunks[1]
    assert sorted(n.index for n in doc.neighbors(mid)) == [0, 2]
    assert [n.index for n in doc.neighbors(doc.chunks[0])] == [1]


def test_tokenize_drops_stopwords_and_lowercases():
    assert tokenize("The Battery is rated for 1000 cycles") == ["battery", "rated", "1000", "cycles"]


def test_bm25_ranks_matching_chunk_first():
    texts = list(TOPICS.values())
    scores = BM25(texts).scores("how many charge cycles does the battery last")
    assert scores.index(max(scores)) == list(TOPICS).index("battery")


def test_answerable_context_contains_gold_and_fills_from_same_library():
    c = _corpus()
    idx = LibraryIndex.build(c, "lib1")
    gold = c.chunk(("aurora.md", 1))  # battery
    ctx = answerable_context(c, idx, "how many charge cycles does the battery last", [gold], k=5, rng=random.Random(0))
    assert len(ctx) == 5
    assert gold in ctx
    assert len({x.key for x in ctx}) == 5
    assert all(x.library == "lib1" for x in ctx)


def test_answerable_context_shuffles_deterministically():
    c = _corpus()
    idx = LibraryIndex.build(c, "lib1")
    gold = c.chunk(("aurora.md", 1))
    a = answerable_context(c, idx, "battery cycles", [gold], k=4, rng=random.Random(7))
    b = answerable_context(c, idx, "battery cycles", [gold], k=4, rng=random.Random(7))
    assert [x.key for x in a] == [x.key for x in b]


def test_negative_context_excludes_gold_and_its_neighbors():
    c = _corpus()
    idx = LibraryIndex.build(c, "lib1")
    gold = c.chunk(("aurora.md", 1))
    ctx = negative_context(c, idx, "how many charge cycles does the battery last", gold, k=5)
    keys = {x.key for x in ctx}
    assert ("aurora.md", 1) not in keys
    assert ("aurora.md", 0) not in keys and ("aurora.md", 2) not in keys
    assert keys <= {x.key for x in c.chunks("lib1")}
    assert len(ctx) == 3  # 6 chunks in lib1 minus gold minus two neighbors


def test_render_sources_uses_requested_name_style():
    c = _corpus()
    idx = LibraryIndex.build(c, "lib1")
    gold = c.chunk(("faq.txt", 0))
    ctx = answerable_context(c, idx, "phone support number", [gold], k=2, rng=random.Random(1))
    by_file = render_sources(c, ctx, "filename")
    by_title = render_sources(c, ctx, "title")
    assert {s["documentName"] for s in by_file} <= {"aurora.md", "faq.txt"}
    assert {s["documentName"] for s in by_title} <= {"Aurora Handbook", "Support FAQ"}
    assert all({"documentName", "content", "normalized"} <= set(s) for s in by_file)


def test_choose_k_is_mostly_top_k():
    rng = random.Random(3)
    ks = [choose_k(rng, 5, short_share=0.1) for _ in range(2000)]
    short = sum(k < 5 for k in ks) / len(ks)
    assert 0.05 < short < 0.15
    assert all(1 <= k <= 5 for k in ks)


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for test in tests:
        test()
        print(f"ok  {test.__name__}")
    print(f"{len(tests)} passed")
