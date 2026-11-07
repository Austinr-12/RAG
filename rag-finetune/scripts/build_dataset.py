"""Build the grounded-answer dataset: sample, generate with the teacher,
repair, filter, split, and write stats.

    python scripts/build_dataset.py --limit 100 --dry-run     # read 100 candidates, spend cents
    python scripts/build_dataset.py --target 3000             # the real build (cached, resumable)
    python scripts/build_dataset.py --target 3000 --types single,negative --workers 6

Outputs (data/generated/, gitignored unless noted):
  candidates.jsonl   every generated example with its filter verdict and repairs
  dataset.jsonl      the kept examples
  train/validation/test.jsonl   split by library
  results/phase1/dataset-stats.json   (tracked) counts, rejection rates, repairs, mix
A dry run writes dryrun-candidates.jsonl, dryrun-review.md (one section per
candidate, for reading by hand) and dryrun-stats.json instead, all under
data/generated/.

Mix (PLAN.md Phase 1): single 60%, two_gold 10%, negative 18%, partial 5%,
multi-turn 7%. Candidates are oversampled (--oversample, default 1.5) so the
kept set lands near --target after filtering.

Concurrency: candidates are built by a thread pool (--workers, default 5).
Each job derives its own random generator from the run seed and its gold
chunk, so the output does not depend on scheduling, and the teacher cache
makes re-runs free. Repairs (ragft.filters.repair_example) run before the
filter chain in the main thread.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
import threading
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

from ragft.client import ChatClient, Endpoint  # noqa: E402
from ragft.contract import load_contract  # noqa: E402
from ragft.corpus import Chunk, Corpus  # noqa: E402
from ragft.filters import FilterStats, check_example, dedupe, repair_example  # noqa: E402
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
# Expected candidates per gold chunk, used to size each batch of jobs.
YIELD = {"single": 2, "two_gold": 1, "negative": 1, "partial": 1}
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
    """Makes candidates of each type from a gold chunk. Methods are called from
    worker threads: they share the teacher (cached, locked) and the indexes
    (read only), and touch nothing else of the builder except ``_reject``."""

    def __init__(self, corpus: Corpus, teacher: Teacher, contract, seed: int, top_k: int):
        self.corpus, self.teacher, self.contract, self.seed, self.top_k = corpus, teacher, contract, seed, top_k
        self.indexes = {lib: LibraryIndex.build(corpus, lib) for lib in corpus.libraries}
        self.side_rejects: Counter = Counter()
        self._lock = threading.Lock()

    def _reject(self, reason: str) -> None:
        with self._lock:
            self.side_rejects[reason] += 1

    def _rng(self, kind: str, c: Chunk, salt: str = "") -> random.Random:
        """One generator per job, seeded from the run seed and the chunk, so a
        job's choices do not depend on which thread ran it or when."""
        return random.Random(f"{self.seed}|{kind}|{c.document}|{c.index}|{salt}")

    @staticmethod
    def _id(kind: str, c: Chunk, seq: int) -> str:
        return f"{kind}-{c.library}-{c.document[:24]}-{c.index}-{seq}"

    def _new(self, kind: str, c: Chunk, seq: int, question: str, sources, gold, reference, history=()) -> Example:
        return Example(
            id=self._id(kind, c, seq), type=kind, library=c.library, name_style=reference.get("name_style", "filename"),
            question=question, sources=list(sources), history=list(history), gold=gold, reference=reference,
            teacher_model=self.teacher.model, contract_sha256=self.contract.sha256,
        )

    def _questions_for(self, c: Chunk, n: int = 2) -> list[dict]:
        qs = []
        for q in self.teacher.questions(c.normalized, n=n):
            if _flatten(q["answer_span"]) in c.normalized and len(_flatten(q["answer_span"])) <= self.contract.max_quote_chars:
                qs.append(q)
            else:
                self._reject("question_span_not_in_passage")
        return qs

    # -- example types ---------------------------------------------------------
    def single(self, c: Chunk) -> list[Example]:
        rng = self._rng("single", c)
        out = []
        for i, q in enumerate(self._questions_for(c, n=2)):
            style = choose_name_style(rng)
            k = choose_k(rng, self.top_k)
            ctx = answerable_context(self.corpus, self.indexes[c.library], q["question"], [c], k, rng)
            sources = render_sources(self.corpus, ctx, style)
            ex = self._new("single", c, i, q["question"], sources, [gold_ref(c)], {"answer_span": q["answer_span"], "name_style": style, "k": k})
            ex.target = self.teacher.answer(ex.question, ex.sources)
            out.append(ex)
        return out

    def two_gold(self, c: Chunk) -> list[Example]:
        rng = self._rng("two_gold", c)
        lib = self.corpus.libraries[c.library]
        others = [x for d in lib for x in d.chunks if x.document != c.document and gold_worthy(x)] or \
                 [x for x in self.corpus.document_of(c).chunks if abs(x.index - c.index) > 1 and gold_worthy(x)]
        if not others:
            return []
        b = rng.choice(others)
        out = []
        for i, q in enumerate(self.teacher.two_passage_questions(c.normalized, b.normalized, n=1)):
            if _flatten(q["answer_span_a"]) not in c.normalized or _flatten(q["answer_span_b"]) not in b.normalized:
                self._reject("two_gold_span_not_in_passage")
                continue
            style = choose_name_style(rng)
            ctx = answerable_context(self.corpus, self.indexes[c.library], q["question"], [c, b], self.top_k, rng)
            sources = render_sources(self.corpus, ctx, style)
            ex = self._new("two_gold", c, i, q["question"], sources, [gold_ref(c), gold_ref(b)],
                           {"answer_span_a": q["answer_span_a"], "answer_span_b": q["answer_span_b"], "name_style": style, "k": self.top_k})
            ex.target = self.teacher.answer(ex.question, ex.sources)
            out.append(ex)
        return out

    def negative(self, c: Chunk) -> list[Example]:
        rng = self._rng("negative", c)
        out = []
        for i, q in enumerate(self._questions_for(c, n=1)):
            style = choose_name_style(rng)
            k = choose_k(rng, self.top_k)
            ctx = negative_context(self.corpus, self.indexes[c.library], q["question"], c, k)
            if not ctx:
                continue
            sources = render_sources(self.corpus, ctx, style)
            if self.teacher.is_answerable(q["question"], sources):
                self._reject("negative_still_answerable")
                continue
            desc = self.teacher.describe_sources(sources)
            target = canonical_abstention(self.contract) + (f" {desc}" if desc else "")
            ex = self._new("negative", c, i, q["question"], sources, [gold_ref(c)],
                           {"answer_span": q["answer_span"], "name_style": style, "k": k, "teacher_reply_discarded": True})
            ex.target = target
            out.append(ex)
        return out

    def partial(self, c: Chunk) -> list[Example]:
        rng = self._rng("partial", c)
        qs = self._questions_for(c, n=1)
        doc = self.corpus.document_of(c)
        far = [x for x in doc.chunks if abs(x.index - c.index) > 2 and gold_worthy(x)]
        if not qs or not far:
            return []
        other = rng.choice(far)
        oq = self._questions_for(other, n=1)
        if not oq:
            return []
        question = f"{qs[0]['question']} Also, {oq[0]['question'][0].lower() + oq[0]['question'][1:]}"
        style = choose_name_style(rng)
        ctx = answerable_context(self.corpus, self.indexes[c.library], qs[0]["question"], [c], self.top_k, rng)
        ctx = [x for x in ctx if abs(x.index - other.index) > 1 or x.document != other.document] or ctx
        sources = render_sources(self.corpus, ctx, style)
        ex = self._new("partial", c, 0, question, sources, [gold_ref(c)],
                       {"answer_span": qs[0]["answer_span"], "uncovered_question": oq[0]["question"], "name_style": style, "k": len(ctx)})
        ex.target = self.teacher.answer(ex.question, ex.sources)
        ex.reference.update(self.teacher.partial_check(ex.question, ex.target))
        return [ex]

    def multiturn(self, first: Example, c: Chunk) -> list[Example]:
        """A follow-up after a kept single example from the same library:
        answerable (new gold), uncovered (hard negative), or empty sources."""
        rng = self._rng("multiturn", c, salt=first.id)
        out = []
        history = [{"role": "user", "content": first.question}, {"role": "assistant", "content": first.target or ""}]
        qs = self._questions_for(c, n=1)
        if not qs:
            return out
        q = qs[0]["question"]
        variant = rng.choice(["answerable", "answerable", "uncovered", "empty"])
        if variant == "answerable":
            ctx = answerable_context(self.corpus, self.indexes[c.library], q, [c], self.top_k, rng)
            sources = render_sources(self.corpus, ctx, first.name_style)
            ex = self._new("multiturn_answerable", c, 0, q, sources, [gold_ref(c)], {"answer_span": qs[0]["answer_span"], "name_style": first.name_style, "k": self.top_k}, history)
            ex.target = self.teacher.answer(q, sources, history)
        elif variant == "uncovered":
            ctx = negative_context(self.corpus, self.indexes[c.library], q, c, self.top_k)
            sources = render_sources(self.corpus, ctx, first.name_style)
            if self.teacher.is_answerable(q, sources):
                self._reject("negative_still_answerable")
                return out
            ex = self._new("multiturn_uncovered", c, 0, q, sources, [gold_ref(c)], {"name_style": first.name_style, "k": self.top_k}, history)
            ex.target = canonical_abstention(self.contract)
        else:
            ex = self._new("multiturn_empty", c, 0, q, [], [gold_ref(c)], {"name_style": first.name_style, "k": 0}, history)
            ex.target = self.contract.no_sources_reply
        out.append(ex)
        return out


def write_jsonl(path: Path, examples: list[Example]) -> None:
    with path.open("w", encoding="utf-8") as fh:
        for ex in examples:
            fh.write(json.dumps(ex.to_json(), ensure_ascii=False) + "\n")


def write_review(candidates: list[Example], path: Path) -> None:
    """One section per candidate for reading by hand: question, source names,
    gold span, repairs, verdict and the full target."""
    lines = [
        f"# Dry-run review: {len(candidates)} candidates",
        "",
        "For each one: is the question natural, is the answer right for the gold span, "
        "is the cited name exact, is the verdict fair, did a repair change the meaning?",
        "",
    ]
    for i, ex in enumerate(candidates, 1):
        lines += [f"## {i}. [{ex.type}] {ex.filter} | {ex.library} | names={ex.name_style} k={len(ex.sources)}", ""]
        for m in ex.history:
            lines.append(f"- history {m['role']}: {m['content'][:200]}")
        if ex.history:
            lines.append("")
        lines += [f"**Q:** {ex.question}", ""]
        names = list(dict.fromkeys(s["documentName"] for s in ex.sources))
        lines += ["**Sources:** " + ("; ".join(names) if names else "(none)"), ""]
        spans = [str(ex.reference[k]) for k in ("answer_span", "answer_span_a", "answer_span_b") if ex.reference.get(k)]
        if spans:
            lines += ["**Gold span(s):** " + " | ".join(spans), ""]
        if ex.reference.get("uncovered_question"):
            lines += [f"**Uncovered part:** {ex.reference['uncovered_question']}", ""]
        for r in ex.reference.get("repairs", []):
            lines.append(f"- repair `{r['kind']}`: `{r['from']}` -> `{r['to']}`")
        if ex.reference.get("repairs"):
            lines.append("")
        lines += ["**A:**", "", "```text", *(ex.target or "").split("\n"), "```", ""]
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", type=int, default=3000, help="kept examples to aim for")
    ap.add_argument("--limit", type=int, help="cap on candidates (for dry runs)")
    ap.add_argument("--oversample", type=float, default=1.5)
    ap.add_argument("--types", default=",".join(MIX), help="comma list of types to build")
    ap.add_argument("--seed", type=int, default=20261023)
    ap.add_argument("--teacher", default="gpt-4o-mini")
    ap.add_argument("--workers", type=int, default=5, help="concurrent teacher jobs")
    ap.add_argument("--dry-run", action="store_true", help="write the review files under data/generated/ instead of the dataset")
    args = ap.parse_args()

    load_dotenv(ROOT / ".env")
    contract = load_contract()
    corpus = Corpus.load()
    rng = random.Random(args.seed)
    client = ChatClient(Endpoint.openai(args.teacher), contract)
    cache = ResponseCache()
    teacher = Teacher(client, contract, cache)
    builder = Builder(corpus, teacher, contract, args.seed, contract.top_k)
    types = [t for t in args.types.split(",") if t]
    workers = max(1, args.workers)

    n_cand = int(args.target * args.oversample)
    if args.limit:
        n_cand = min(n_cand, args.limit)
    quota = {t: max(1, round(n_cand * MIX[t])) for t in types}
    print(f"corpus: {corpus.summary()['documents']} docs, {corpus.summary()['chunks']} chunks | candidates planned: {quota} | workers: {workers}")

    golds = sample_gold_chunks(corpus, sum(quota.values()) + 50, rng)
    stats = FilterStats()
    kept: list[Example] = []
    candidates: list[Example] = []
    started = time.perf_counter()
    gi = 0

    def run(exs: list[Example]) -> None:
        for ex in exs:
            repairs = repair_example(contract, ex)
            reason = check_example(contract, ex)
            ex.filter = reason or "ok"
            stats.record(ex, reason, repairs)
            candidates.append(ex)
            if reason is None:
                kept.append(ex)
            if args.dry_run:
                print("=" * 78)
                print(f"[{ex.type}] {ex.filter} | {ex.library} | names={ex.name_style} k={len(ex.sources)}")
                print("Q:", ex.question)
                for r in repairs:
                    print(f"repair {r['kind']}: {r['from'][:80]!r} -> {r['to'][:80]!r}")
                print("A:", (ex.target or "")[:700])

    def safe(fn):
        """One failed candidate (network, a malformed reply) must not end a
        long build; it is counted and the build goes on."""
        def wrapped(*a):
            try:
                return fn(*a)
            except Exception as e:  # noqa: BLE001
                builder._reject("job_error")
                print(f"  job failed: {type(e).__name__}: {str(e)[:200]}", file=sys.stderr, flush=True)
                return []
        return wrapped

    def progress(t: str, made: int, want: int) -> None:
        print(f"  {t}: {made}/{want} candidates, kept {stats.kept}, repaired {stats.repaired}, "
              f"{time.perf_counter() - started:.0f}s, cache hits {cache.hits} misses {cache.misses}", flush=True)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for t in ("single", "two_gold", "negative", "partial"):
            if t not in quota:
                continue
            made = 0
            while made < quota[t] and gi < len(golds):
                need = quota[t] - made
                n = min(len(golds) - gi, max(workers, math.ceil(need / YIELD[t])))
                batch = golds[gi : gi + n]
                gi += n
                for exs in pool.map(safe(getattr(builder, t)), batch):
                    run(exs)
                    made += len(exs)
                progress(t, made, quota[t])
        if "multiturn" in quota:
            singles = [ex for ex in kept if ex.type == "single"]
            rng.shuffle(singles)
            used: set[tuple[str, int]] = set()
            pairs: list[tuple[Example, Chunk]] = []
            for first in singles:
                if len(pairs) >= quota["multiturn"]:
                    break
                same_lib = [c for c in golds if c.library == first.library and c.key not in used]
                cands = [c for c in same_lib if c.document != first.gold[0]["document"]] or same_lib
                if not cands:
                    continue
                c = rng.choice(cands)
                used.add(c.key)
                pairs.append((first, c))
            made = 0
            for exs in pool.map(safe(lambda p: builder.multiturn(*p)), pairs):
                run(exs)
                made += len(exs)
            progress("multiturn", made, quota["multiturn"])

    kept, dup_dropped = dedupe(kept)
    stats.rejected["near_duplicate_question"] = dup_dropped
    stats.kept -= dup_dropped
    splits = split_by_library(kept)

    summary = {
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "teacher": args.teacher,
        "contract_sha256": contract.sha256,
        "seed": args.seed,
        "workers": workers,
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
    OUT.mkdir(parents=True, exist_ok=True)
    if args.dry_run:
        write_jsonl(OUT / "dryrun-candidates.jsonl", candidates)
        write_review(candidates, OUT / "dryrun-review.md")
        (OUT / "dryrun-stats.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"dry run: wrote {OUT / 'dryrun-review.md'}, dryrun-candidates.jsonl and dryrun-stats.json")
    else:
        write_jsonl(OUT / "candidates.jsonl", candidates)
        write_jsonl(OUT / "dataset.jsonl", kept)
        summary["splits"] = write_splits(splits, OUT)
        STATS.parent.mkdir(parents=True, exist_ok=True)
        STATS.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"wrote {OUT / 'dataset.jsonl'} and {STATS}")
    print(json.dumps({k: v for k, v in summary.items() if k != "splits"}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
