"""Simulate the app's retrieval inside one library, without embeddings.

Production retrieves the top-5 chunks across one user's documents with hybrid
search and never applies a similarity threshold, so every answerable example
must look like "the gold chunk plus four plausible same-library chunks", and
every unanswerable example must look like "five plausible same-library chunks
that do not contain the answer". BM25 over the normalized chunk text is a good
enough stand-in for which chunks are plausible: it finds the lexical
neighbors of a question, which is exactly what makes a hard negative hard.

Stdlib only (a small Okapi BM25), deterministic given a seed.
"""

from __future__ import annotations

import math
import random
import re
from collections import Counter
from dataclasses import dataclass
from typing import Iterable, Sequence

from .corpus import Chunk, Corpus, Document

_TOKEN_RE = re.compile(r"[a-z0-9]+(?:'[a-z]+)?")
_STOP = frozenset(
    "the a an and or of to in on for with by at from as is are was were be been it its this that these those "
    "which who whom what when where how why not no do does did can could should would will may might than then "
    "there their they them he she his her you your we our i me my if into about over under between also any".split()
)


def tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN_RE.findall(text.lower()) if len(t) > 1 and t not in _STOP]


class BM25:
    """Okapi BM25 (k1=1.5, b=0.75) over a fixed list of documents."""

    def __init__(self, texts: Sequence[str], k1: float = 1.5, b: float = 0.75):
        self.k1, self.b = k1, b
        self.docs = [Counter(tokenize(t)) for t in texts]
        self.lengths = [sum(c.values()) for c in self.docs]
        self.avg_len = (sum(self.lengths) / len(self.lengths)) if self.lengths else 0.0
        df: Counter[str] = Counter()
        for c in self.docs:
            df.update(c.keys())
        n = len(self.docs)
        self.idf = {term: math.log(1 + (n - f + 0.5) / (f + 0.5)) for term, f in df.items()}

    def scores(self, query: str) -> list[float]:
        q = tokenize(query)
        out = []
        for counts, length in zip(self.docs, self.lengths):
            s = 0.0
            norm = self.k1 * (1 - self.b + self.b * length / self.avg_len) if self.avg_len else self.k1
            for term in q:
                tf = counts.get(term)
                if not tf:
                    continue
                s += self.idf[term] * tf * (self.k1 + 1) / (tf + norm)
            out.append(s)
        return out


@dataclass
class LibraryIndex:
    library: str
    chunks: list[Chunk]
    bm25: BM25

    @classmethod
    def build(cls, corpus: Corpus, library: str) -> "LibraryIndex":
        chunks = list(corpus.chunks(library))
        return cls(library, chunks, BM25([c.normalized for c in chunks]))

    def search(self, query: str, k: int, exclude: Iterable[tuple[str, int]] = ()) -> list[Chunk]:
        """Top-k chunks by BM25, skipping excluded keys. Ties break by corpus order."""
        banned = set(exclude)
        ranked = sorted(
            ((s, i) for i, s in enumerate(self.bm25.scores(query)) if self.chunks[i].key not in banned),
            key=lambda p: (-p[0], p[1]),
        )
        return [self.chunks[i] for _, i in ranked[:k]]


def _exclusion_keys(corpus: Corpus, golds: Sequence[Chunk], with_neighbors: bool) -> set[tuple[str, int]]:
    keys = {g.key for g in golds}
    if with_neighbors:
        for g in golds:
            keys.update(n.key for n in corpus.document_of(g).neighbors(g))
    return keys


def answerable_context(
    corpus: Corpus, index: LibraryIndex, question: str, golds: Sequence[Chunk], k: int, rng: random.Random
) -> list[Chunk]:
    """Gold chunk(s) plus the most plausible other chunks of the library, in a
    shuffled order so the model cannot learn 'the answer is always first'."""
    if len(golds) > k:
        raise ValueError("more gold chunks than context slots")
    fillers = index.search(question, k - len(golds), exclude=_exclusion_keys(corpus, golds, with_neighbors=False))
    context = list(golds) + fillers
    rng.shuffle(context)
    return context


def negative_context(corpus: Corpus, index: LibraryIndex, question: str, gold: Chunk, k: int) -> list[Chunk]:
    """Hard negative: the chunks BM25 finds most plausible for the question,
    with the gold chunk and its overlapping neighbors removed. The answer is
    not in the context, but the topic is, which is what makes abstention hard."""
    return index.search(question, k, exclude=_exclusion_keys(corpus, [gold], with_neighbors=True))


def render_sources(corpus: Corpus, context: Sequence[Chunk], name_style: str) -> list[dict[str, str]]:
    """Sources in the shape ``build_messages``/``scan_citations`` expect.
    ``name_style`` is ``"filename"`` (production) or ``"title"``."""
    return [
        {
            "documentName": corpus.document_of(c).display_name(name_style),
            "content": c.content,
            "normalized": c.normalized,
        }
        for c in context
    ]


def choose_name_style(rng: random.Random, title_share: float = 0.3) -> str:
    return "title" if rng.random() < title_share else "filename"


def choose_k(rng: random.Random, top_k: int, short_share: float = 0.1) -> int:
    """About ``short_share`` of contexts carry fewer than top_k chunks, as
    happens in production for users with few documents."""
    if rng.random() < short_share:
        return rng.randint(1, max(1, top_k - 1))
    return top_k


def document_text(doc: Document) -> str:
    """Whole-document normalized text, for checks that a quote exists anywhere in it."""
    return " ".join(c.normalized for c in doc.chunks)
