"""Build the grounded-answer dataset: sample, generate with the teacher,
filter, split, and write stats.

    python scripts/build_dataset.py --limit 40 --dry-run      # read 40 candidates, spend cents
    python scripts/build_dataset.py --target 3000              # the real build (cached, resumable)
    python scripts/build_dataset.py --target 3000 --types single,negative

Outputs (data/generated/, gitignored unless noted):
  candidates.jsonl   every generated example with its filter verdict
  dataset.jsonl      the kept examples
  train/validation/test.jsonl   split by library
  results/phase1/dataset-stats.json   (tracked) counts, rejection rates, mix

Mix (PLAN.md Phase 1): single 60%, two_gold 10%, negative 18%, partial 5%,
multi-turn 7%. Candidates are oversampled (--oversample, default 1.5) so the
kept set lands near --target after filtering.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

from ragft.client import ChatClient, Endpoint  # noqa: E402
from ragft.contract import load_contract  # noqa: E402
from ragft.corpus import Chunk, Corpus  # noqa: E402
from ragft.filters import FilterStats, check_example, dedupe  # noqa: E402
from ragft.retrieval_sim import (  # noqa: E402
    LibraryIndex,
    answerable_context,
    choose_k,
    choose_name_style,
    negative_context,
    render_sources,
)
from ragft.split import split_by_library, write_splits  # noqa: E402
from ragft.teacher import Example, ResponseCache, Teacher, canonical_abstention  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "generated"
STATS = ROOT / "results" / "phase1" / "dataset-stats.json"
MIX = {"single": 0.60, "two_gold": 0.10, "negative": 0.18, "partial": 0.05, "multiturn": 0.07}
MAX_PER_DOCUMENT = 40
MIN_GOLD_CHARS = 350
MIN_ALPHA_RATIO = 0.6


def gold_worthy(c: Chunk) -> bool:
    """Skip front matter, tables of numbers and tiny tail chunks."""
    t = c.normalized
    if len(t) < MIN_GOLD_CHARS:
        return False
    alpha = sum(ch.isalpha() for ch in t) / len(t)
    return alpha >= MIN_ALPHA_RATIO


def _flatten(s: str) -> str:
    return " ".join(s.split())


def sample_gold_chunks(corpus: Corpus, n: int, rng: random.Random) -> list[Chunk]:
    """Round-robin over libraries and documents with a per-document cap, so
    the 1,800-chunk IRS and NIST files do not dominate the 40-chunk circulars."""
    per_doc: dict[str, list[Chunk]] = {}
    for d in corpus.documents.values():
        cands = [c for c in d.chunks if gold_worthy(c)]
        rng.shuffle(cands)
        if cands:
            per_doc[d.filename] = cands[:MAX_PER_DOCUMENT]
    by_lib: dict[str, list[str]] = defaultdict(list)
    for name in per_doc:
        by_lib[corpus.documents[name].library].append(name)
    picked: list[Chunk] = []
    libs = sorted(by_lib)
    cursors = {name: 0 for name in per_doc}
    while len(picked) < n and any(cursors[nm] < len(per_doc[nm]) for nm in per_doc):
        for lib in libs:
            for name in by_lib[lib]:
                i = cursors[name]
                if i < len(per_doc[name]):
                    picked.append(per_doc[name][i])
                    cursors[name] = i + 1
                    if len(picked) >= n:
                        return picked
    return picked


def gold_ref(c: Chunk) -> dict:
    return {"document": c.document, "index": c.index, "normalized": c.normalized}


class Builder:
    def __init__(self, corpus: Corpus, teacher: Teacher, contract, rng: random.Random, top_k: int):
        self.corpus, self.teacher, self.contract, self.rng, self.top_k = corpus, teacher, contract, rng, top_k
        self.indexes = {lib: LibraryIndex.build(corpus, lib) for lib in corpus.libraries}
        self.counter = Counter()
        self.side_rejects: Counter = Counter()

    def _id(self, kind: str, c: Chunk) -> str:
        self.counter[kind] += 1
        return f"{kind}-{c.library}-{c.document[:24]}-{c.index}-{self.counter[kind]}"

    def _new(self, kind: str, c: Chunk, question: str, sources, gold, reference, history=()) -> Example:
        return Example(
            id=self._id(kind, c), type=kind, library=c.library, name_style=reference.get("name_style", "filename"),
            question=question, sources=list(sources), history=list(history), gold=gold, reference=reference,
            teacher_model=self.teacher.model, contract_sha256=self.contract.sha256,
        )

    def _questions_for(self, c: Chunk, n: int = 2) -> list[dict]:
        qs = []
        for q in self.teacher.questions(c.normalized, n=n):
            if _flatten(q["answer_span"]) in c.normalized and len(_flatten(q["answer_span"])) <= self.contract.max_quote_chars:
                qs.append(q)
            else:
                self.side_rejects["question_span_not_in_passage"] += 1
        return qs

    # -- example types ---------------------------------------------------------
    def single(self, c: Chunk) -> list[Example]:
        out = []
        for q in self._questions_for(c, n=2):
            style = choose_name_style(self.rng)
            k = choose_k(self.rng, self.top_k)
            ctx = answerable_context(self.corpus, self.indexes[c.library], q["question"], [c], k, self.rng)
            sources = render_sources(self.corpus, ctx, style)
            ex = self._new("single", c, q["question"], sources, [gold_ref(c)], {"answer_span": q["answer_span"], "name_style": style, "k": k})
            ex.target = self.teacher.answer(ex.question, ex.sources)
            out.append(ex)
        return out

    def two_gold(self, c: Chunk) -> list[Example]:
        lib = self.corpus.libraries[c.library]
        others = [x for d in lib for x in d.chunks if x.document != c.document and gold_worthy(x)] or \
                 [x for x in self.corpus.document_of(c).chunks if abs(x.index - c.index) > 1 and gold_worthy(x)]
        if not others:
            return []
        b = self.rng.choice(others)
        out = []
        for q in self.teacher.two_passage_questions(c.normalized, b.normalized, n=1):
            if _flatten(q["answer_span_a"]) not in c.normalized or _flatten(q["answer_span_b"]) not in b.normalized:
                self.side_rejects["two_gold_span_not_in_passage"] += 1
                continue
            style = choose_name_style(self.rng)
            ctx = answerable_context(self.corpus, self.indexes[c.library], q["question"], [c, b], self.top_k, self.rng)
            sources = render_sources(self.corpus, ctx, style)
            ex = self._new("two_gold", c, q["question"], sources, [gold_ref(c), gold_ref(b)],
                           {"answer_span_a": q["answer_span_a"], "answer_span_b": q["answer_span_b"], "name_style": style, "k": self.top_k})
            ex.target = self.teacher.answer(ex.question, ex.sources)
            out.append(ex)
        return out

    def negative(self, c: Chunk) -> list[Example]:
        out = []
        for q in self._questions_for(c, n=1):
            style = choose_name_style(self.rng)
            k = choose_k(self.rng, self.top_k)
            ctx = negative_context(self.corpus, self.indexes[c.library], q["question"], c, k)
            if not ctx:
                continue
            sources = render_sources(self.corpus, ctx, style)
            if self.teacher.is_answerable(q["question"], sources):
                self.side_rejects["negative_still_answerable"] += 1
                continue
            desc = self.teacher.describe_sources(sources)
            target = canonical_abstention(self.contract) + (f" {desc}" if desc else "")
            ex = self._new("negative", c, q["question"], sources, [gold_ref(c)],
                           {"answer_span": q["answer_span"], "name_style": style, "k": k, "teacher_reply_discarded": True})
            ex.target = target
            out.append(ex)
        return out

    def partial(self, c: Chunk) -> list[Example]:
        qs = self._questions_for(c, n=1)
        doc = self.corpus.document_of(c)
        far = [x for x in doc.chunks if abs(x.index - c.index) > 2 and gold_worthy(x)]
        if not qs or not far:
            return []
        other = self.rng.choice(far)
        oq = self._questions_for(other, n=1)
        if not oq:
            return []
        question = f"{qs[0]['question']} Also, {oq[0]['question'][0].lower() + oq[0]['question'][1:]}"
        style = choose_name_style(self.rng)
        ctx = answerable_context(self.corpus, self.indexes[c.library], qs[0]["question"], [c], self.top_k, self.rng)
        ctx = [x for x in ctx if abs(x.index - other.index) > 1 or x.document != other.document] or ctx
        sources = render_sources(self.corpus, ctx, style)
        ex = self._new("partial", c, question, sources, [gold_ref(c)],
                       {"answer_span": qs[0]["answer_span"], "uncovered_question": oq[0]["question"], "name_style": style, "k": len(ctx)})
        ex.target = self.teacher.answer(ex.question, ex.sources)
        ex.reference.update(self.teacher.partial_check(ex.question, ex.target))
        return [ex]

    def multiturn(self, first: Example, c: Chunk) -> list[Example]:
        """A follow-up after a kept single example from the same library:
        answerable (new gold), uncovered (hard negative), or empty sources."""
        out = []
        history = [{"role": "user", "content": first.question}, {"role": "assistant", "content": first.target or ""}]
        qs = self._questions_for(c, n=1)
        if not qs:
            return out
        q = qs[0]["question"]
        variant = self.rng.choice(["answerable", "answerable", "uncovered", "empty"])
        if variant == "answerable":
            ctx = answerable_context(self.corpus, self.indexes[c.library], q, [c], self.top_k, self.rng)
            sources = render_sources(self.corpus, ctx, first.name_style)
            ex = self._new("multiturn_answerable", c, q, sources, [gold_ref(c)], {"answer_span": qs[0]["answer_span"], "name_style": first.name_style, "k": self.top_k}, history)
            ex.target = self.teacher.answer(q, sources, history)
        elif variant == "uncovered":
            ctx = negative_context(self.corpus, self.indexes[c.library], q, c, self.top_k)
            sources = render_sources(self.corpus, ctx, first.name_style)
            if self.teacher.is_answerable(q, sources):
                self.side_rejects["negative_still_answerable"] += 1
                return out
            ex = self._new("multiturn_uncovered", c, q, sources, [gold_ref(c)], {"name_style": first.name_style, "k": self.top_k}, history)
            ex.target = canonical_abstention(self.contract)
        else:
            ex = self._new("multiturn_empty", c, q, [], [gold_ref(c)], {"name_style": first.name_style, "k": 0}, history)
            ex.target = self.contract.no_sources_reply
        out.append(ex)
        return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", type=int, default=3000, help="kept examples to aim for")
    ap.add_argument("--limit", type=int, help="cap on candidates (for dry runs)")
    ap.add_argument("--oversample", type=float, default=1.5)
    ap.add_argument("--types", default=",".join(MIX), help="comma list of types to build")
    ap.add_argument("--seed", type=int, default=20261023)
    ap.add_argument("--teacher", default="gpt-4o-mini")
    ap.add_argument("--dry-run", action="store_true", help="print examples, write nothing but the cache")
    args = ap.parse_args()

    load_dotenv(ROOT / ".env")
    contract = load_contract()
    corpus = Corpus.load()
    rng = random.Random(args.seed)
    client = ChatClient(Endpoint.openai(args.teacher), contract)
    cache = ResponseCache()
    teacher = Teacher(client, contract, cache)
    builder = Builder(corpus, teacher, contract, rng, contract.top_k)
    types = [t for t in args.types.split(",") if t]

    n_cand = int(args.target * args.oversample)
    if args.limit:
        n_cand = min(n_cand, args.limit)
    quota = {t: max(1, round(n_cand * MIX[t])) for t in types}
    print(f"corpus: {corpus.summary()['documents']} docs, {corpus.summary()['chunks']} chunks | candidates planned: {quota}")

    golds = sample_gold_chunks(corpus, sum(quota.values()) + 50, rng)
    stats = FilterStats()
    kept: list[Example] = []
    candidates: list[Example] = []
    started = time.perf_counter()
    gi = 0

    def take() -> Chunk:
        nonlocal gi
        c = golds[gi % len(golds)]
        gi += 1
        return c

    def run(exs: list[Example]) -> None:
        for ex in exs:
            reason = check_example(contract, ex)
            ex.filter = reason or "ok"
            stats.record(ex, reason)
            candidates.append(ex)
            if reason is None:
                kept.append(ex)
            if args.dry_run:
                print("=" * 78)
                print(f"[{ex.type}] {ex.filter} | {ex.library} | names={ex.name_style} k={len(ex.sources)}")
                print("Q:", ex.question)
                print("A:", (ex.target or "")[:700])

    for t in ("single", "two_gold", "negative", "partial"):
        made = 0
        while t in quota and made < quota[t] and gi < len(golds) * 3:
            exs = getattr(builder, t)(take())
            run(exs)
            made += len(exs)
            if made and made % 50 == 0:
                print(f"  {t}: {made}/{quota[t]} candidates, kept so far {stats.kept}, {time.perf_counter() - started:.0f}s, cache hits {cache.hits} misses {cache.misses}")
    if "multiturn" in quota:
        singles = [ex for ex in kept if ex.type == "single"]
        rng.shuffle(singles)
        made = 0
        for first in singles:
            if made >= quota["multiturn"]:
                break
            lib_chunks = [c for c in golds if c.library == first.library and c.document != first.gold[0]["document"]] or \
                         [c for c in golds if c.library == first.library]
            if not lib_chunks:
                continue
            exs = builder.multiturn(first, rng.choice(lib_chunks))
            run(exs)
            made += len(exs)

    kept, dup_dropped = dedupe(kept)
    stats.rejected["near_duplicate_question"] = dup_dropped
    stats.kept -= dup_dropped
    splits = split_by_library(kept)

    summary = {
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "teacher": args.teacher,
        "contract_sha256": contract.sha256,
        "seed": args.seed,
        "candidates_planned": quota,
        "filters": stats.to_dict(),
        "side_rejections": dict(builder.side_rejects),
        "kept_by_type": dict(Counter(ex.type for ex in kept).most_common()),
        "kept_by_library": dict(Counter(ex.library for ex in kept).most_common()),
        "name_styles": dict(Counter(ex.name_style for ex in kept)),
        "short_contexts": sum(1 for ex in kept if 0 < len(ex.sources) < contract.top_k),
        "cache": {"hits": cache.hits, "misses": cache.misses},
        "elapsed_s": round(time.perf_counter() - started),
    }
    if not args.dry_run:
        OUT.mkdir(parents=True, exist_ok=True)
        with (OUT / "candidates.jsonl").open("w", encoding="utf-8") as fh:
            for ex in candidates:
                fh.write(json.dumps(ex.to_json(), ensure_ascii=False) + "\n")
        with (OUT / "dataset.jsonl").open("w", encoding="utf-8") as fh:
            for ex in kept:
                fh.write(json.dumps(ex.to_json(), ensure_ascii=False) + "\n")
        summary["splits"] = write_splits(splits, OUT)
        STATS.parent.mkdir(parents=True, exist_ok=True)
        STATS.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"wrote {OUT / 'dataset.jsonl'} and {STATS}")
    print(json.dumps({k: v for k, v in summary.items() if k != "splits"}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
