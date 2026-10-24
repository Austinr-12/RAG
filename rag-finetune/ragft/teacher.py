"""Teacher calls for the dataset build, and the example record they produce.

Two kinds of calls:

* **Production answers** go through ``build_messages`` with the real system
  prompt and the contract's sampling. The teacher sees exactly what the
  fine-tuned model will see; its reply becomes the training target after the
  filter chain approves it.
* **Side calls** (question generation, unanswerability check, partial-answer
  check, source description) use their own prompts and JSON mode. They never
  become targets directly.

Every call is cached on disk by a hash of its request, so re-running the
builder after a crash, a filter change or a bug costs nothing. The cache file
is ``data/generated/teacher-cache.jsonl`` (gitignored).
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any, Mapping, Sequence

from .contract import Contract, build_messages

if TYPE_CHECKING:  # the OpenAI SDK is only needed when a Teacher is actually built
    from .client import ChatClient

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE = ROOT / "data" / "generated" / "teacher-cache.jsonl"


def canonical_abstention(contract: Contract) -> str:
    """First sentence of the app's no-sources reply: the one voice for 'not here'."""
    text = contract.no_sources_reply.strip()
    m = re.match(r"^(.+?[.!?])(\s|$)", text)
    return m.group(1) if m else text


@dataclass
class Example:
    id: str
    type: str
    library: str
    name_style: str
    question: str
    sources: list[dict[str, str]]
    history: list[dict[str, str]] = field(default_factory=list)
    gold: list[dict[str, Any]] = field(default_factory=list)
    reference: dict[str, Any] = field(default_factory=dict)
    target: str | None = None
    teacher_model: str = ""
    contract_sha256: str = ""
    filter: str | None = None  # None until filtered; "ok" or the first failing reason

    def messages(self, contract: Contract) -> list[dict[str, str]]:
        return build_messages(contract, self.question, self.sources, self.history)

    def to_json(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_json(cls, d: Mapping[str, Any]) -> "Example":
        return cls(**d)

    @property
    def answerable(self) -> bool:
        return self.type in {"single", "two_gold", "partial", "multiturn_answerable"}


class ResponseCache:
    def __init__(self, path: Path = DEFAULT_CACHE):
        self.path = path
        self._mem: dict[str, str] = {}
        if path.exists():
            with path.open(encoding="utf-8") as fh:
                for line in fh:
                    if line.strip():
                        row = json.loads(line)
                        self._mem[row["key"]] = row["text"]
        self.hits = 0
        self.misses = 0

    @staticmethod
    def key(model: str, messages: Sequence[Mapping[str, str]], **opts: Any) -> str:
        payload = json.dumps({"model": model, "messages": list(messages), "opts": opts}, sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def get(self, key: str) -> str | None:
        text = self._mem.get(key)
        if text is not None:
            self.hits += 1
        return text

    def put(self, key: str, text: str) -> None:
        self.misses += 1
        self._mem[key] = text
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"key": key, "text": text}, ensure_ascii=False) + "\n")


QUESTION_SYSTEM = """You write questions for testing a document question-answering assistant.
Given one passage from a user's document, write {n} questions that:
- can each be answered from this passage alone, with a specific fact (a number, name, date, condition, procedure step, definition or rule);
- sound like a real person who has NOT read the passage and does not know its wording (never say "according to the passage" or "the text");
- vary in form (how much, when, what happens if, which, can I, what is the difference);
- are not answerable from general knowledge alone.
For each question give answer_span: the shortest EXACT substring of the passage (copy it character for character, at most 200 characters) that answers it.
Return JSON: {{"questions": [{{"question": "...", "answer_span": "..."}}]}}"""

TWO_PASSAGE_SYSTEM = """You write questions for testing a document question-answering assistant.
Given two passages from a user's documents, write {n} questions that each REQUIRE information from BOTH passages (for example a comparison, a combination of two conditions, or a value from each). Each question must sound like a real person who has not read the passages.
For each question give answer_span_a (exact substring of passage A, at most 200 characters) and answer_span_b (exact substring of passage B, at most 200 characters) that together answer it.
Return JSON: {{"questions": [{{"question": "...", "answer_span_a": "...", "answer_span_b": "..."}}]}}"""

UNANSWERABLE_SYSTEM = """You check whether a question can be answered from given sources.
Answer "answerable": true only if the sources state the specific fact the question asks for. Related but insufficient information means false.
Return JSON: {"answerable": true|false, "why": "one short sentence"}"""

PARTIAL_SYSTEM = """You check an assistant's reply to a two-part question where only one part was covered by the sources.
Return JSON: {"answers_covered_part": true|false, "acknowledges_uncovered_part": true|false}
acknowledges_uncovered_part is true only if the reply explicitly says that the documents/sources do not cover or do not mention the other part (rather than answering it from general knowledge or ignoring it)."""

DESCRIBE_SYSTEM = """In one short sentence (at most 25 words), say what the given sources are about, starting with "The sources cover". Do not answer any question and do not quote them. Return plain text."""


def _render_passages(sources: Sequence[Mapping[str, str]]) -> str:
    return "\n\n---\n\n".join(f"[{i + 1}] {s['documentName']}\n{s['normalized']}" for i, s in enumerate(sources))


class Teacher:
    def __init__(self, client: "ChatClient", contract: Contract, cache: ResponseCache | None = None):
        self.client = client
        self.contract = contract
        self.cache = cache or ResponseCache()
        self.model = client.endpoint.model

    # -- plumbing -----------------------------------------------------------
    def _call(self, messages: list[dict[str, str]], **opts: Any) -> str:
        key = ResponseCache.key(self.model, messages, **opts)
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        result = self.client.complete(messages, **opts)
        self.cache.put(key, result.text)
        return result.text

    def _json(self, system: str, user: str, *, temperature: float, max_tokens: int = 700) -> dict[str, Any]:
        text = self._call(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=temperature,
            max_tokens=max_tokens,
            json_mode=True,
            seed=0,
        )
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return {}

    # -- production answer ----------------------------------------------------
    def answer(self, question: str, sources: Sequence[Mapping[str, str]], history: Sequence[Mapping[str, str]] = ()) -> str:
        """The teacher's reply to the exact production prompt, contract sampling."""
        return self._call(build_messages(self.contract, question, sources, history), seed=0)

    # -- side calls -----------------------------------------------------------
    def questions(self, passage: str, n: int = 3) -> list[dict[str, str]]:
        data = self._json(QUESTION_SYSTEM.format(n=n), f"PASSAGE:\n{passage}", temperature=0.7)
        out = []
        for q in data.get("questions", []) if isinstance(data, dict) else []:
            if isinstance(q, dict) and q.get("question") and q.get("answer_span"):
                out.append({"question": str(q["question"]).strip(), "answer_span": str(q["answer_span"]).strip()})
        return out

    def two_passage_questions(self, passage_a: str, passage_b: str, n: int = 2) -> list[dict[str, str]]:
        user = f"PASSAGE A:\n{passage_a}\n\nPASSAGE B:\n{passage_b}"
        data = self._json(TWO_PASSAGE_SYSTEM.format(n=n), user, temperature=0.7)
        out = []
        for q in data.get("questions", []) if isinstance(data, dict) else []:
            if isinstance(q, dict) and all(q.get(k) for k in ("question", "answer_span_a", "answer_span_b")):
                out.append({k: str(q[k]).strip() for k in ("question", "answer_span_a", "answer_span_b")})
        return out

    def is_answerable(self, question: str, sources: Sequence[Mapping[str, str]]) -> bool:
        data = self._json(UNANSWERABLE_SYSTEM, f"SOURCES:\n{_render_passages(sources)}\n\nQUESTION: {question}", temperature=0.0, max_tokens=120)
        return bool(data.get("answerable", True))

    def partial_check(self, question: str, reply: str) -> dict[str, bool]:
        data = self._json(PARTIAL_SYSTEM, f"QUESTION: {question}\n\nREPLY:\n{reply}", temperature=0.0, max_tokens=80)
        return {
            "answers_covered_part": bool(data.get("answers_covered_part", False)),
            "acknowledges_uncovered_part": bool(data.get("acknowledges_uncovered_part", False)),
        }

    def describe_sources(self, sources: Sequence[Mapping[str, str]]) -> str:
        text = self._call(
            [{"role": "system", "content": DESCRIBE_SYSTEM}, {"role": "user", "content": f"SOURCES:\n{_render_passages(sources)}"}],
            temperature=0.3,
            max_tokens=60,
            seed=0,
        ).strip()
        first = text.split("\n")[0].strip()
        return first if first.lower().startswith("the sources cover") else ""
