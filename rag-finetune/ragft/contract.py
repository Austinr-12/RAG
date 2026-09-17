"""Python view of the RAG app's prompt contract.

The app (../rag-knowledge-base) is the single source of truth for what the
answer model is given and what it must produce. It serializes that into
``contract/prompt-contract.json``; this module only READS the file. Nothing
here re-types a prompt, a regex or a sampling value.

``tests/test_contract.py`` proves that ``render_prompt`` and ``scan_citations``
reproduce the app's behavior on the golden samples embedded in the contract,
so dataset building, filtering and evaluation all match production exactly.

Stdlib only, so it runs anywhere (Windows, WSL, Colab) without an env.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

DEFAULT_CONTRACT_PATH = (
    Path(__file__).resolve().parents[2]
    / "rag-knowledge-base"
    / "contract"
    / "prompt-contract.json"
)

SUPPORTED_CONTRACT_VERSION = 1


class ContractError(RuntimeError):
    pass


@dataclass(frozen=True)
class Contract:
    raw: Mapping[str, Any]

    @property
    def sha256(self) -> str:
        return self.raw["sha256"]

    @property
    def system_prompt(self) -> str:
        return self.raw["systemPrompt"]

    @property
    def no_sources_reply(self) -> str:
        return self.raw["noSourcesReply"]

    @property
    def citation_pattern(self) -> re.Pattern[str]:
        return re.compile(self.raw["citation"]["linePattern"])

    @property
    def max_quote_chars(self) -> int:
        return self.raw["citation"]["maxQuoteChars"]

    @property
    def top_k(self) -> int:
        return self.raw["retrieval"]["topK"]

    @property
    def temperature(self) -> float:
        return self.raw["generation"]["temperature"]

    @property
    def max_output_tokens(self) -> int:
        return self.raw["generation"]["maxOutputTokens"]


def compute_sha256(raw: Mapping[str, Any]) -> str:
    """Same bytes the app hashes: JSON.stringify(body) without the sha256 key."""
    body = {k: v for k, v in raw.items() if k != "sha256"}
    text = json.dumps(body, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def load_contract(path: Path | str = DEFAULT_CONTRACT_PATH) -> Contract:
    path = Path(path)
    if not path.exists():
        raise ContractError(
            f"{path} not found. Run `npm run export:contract` in rag-knowledge-base."
        )
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("contractVersion") != SUPPORTED_CONTRACT_VERSION:
        raise ContractError(
            f"contractVersion {raw.get('contractVersion')} is not supported "
            f"(expected {SUPPORTED_CONTRACT_VERSION}); update ragft/contract.py."
        )
    if compute_sha256(raw) != raw.get("sha256"):
        raise ContractError(f"{path} was edited by hand: sha256 does not match its body.")
    return Contract(raw)


def render_prompt(question: str, sources: Sequence[Mapping[str, str]]) -> str:
    """Mirror of buildRetrievalPrompt in the app's src/lib/rag/prompt.ts.

    ``sources`` items need ``documentName`` and ``normalized``. Always pass the
    app-normalized text (from export-corpus or eval-generation output); never
    normalize whitespace here — JS and Python disagree on what ``\\s`` matches.
    """
    if not sources:
        return (
            "Sources: (none — the user has no documents that match this question)\n\n"
            f"Question: {question}\n\nAnswer:"
        )
    rendered = "\n\n---\n\n".join(
        f"[{i + 1}] {s['documentName']}\n{s['normalized']}" for i, s in enumerate(sources)
    )
    return f"Sources:\n\n{rendered}\n\nQuestion: {question}\n\nAnswer:"


def build_messages(
    contract: Contract,
    question: str,
    sources: Sequence[Mapping[str, str]],
    history: Iterable[Mapping[str, str]] = (),
) -> list[dict[str, str]]:
    """The exact message layout the app sends: system prompt, prior turns
    unmodified, then the latest user turn replaced by the rendered prompt."""
    return [
        {"role": "system", "content": contract.system_prompt},
        *({"role": m["role"], "content": m["content"]} for m in history),
        {"role": "user", "content": render_prompt(question, sources)},
    ]


def _flatten(text: str) -> str:
    return " ".join(text.split())


def scan_citations(
    contract: Contract, reply: str, sources: Sequence[Mapping[str, str]]
) -> dict[str, Any]:
    """Mirror of extractCitations + verifyCitation in src/lib/rag/citations.ts.

    ``sources`` items need ``documentName`` and either ``normalized`` or
    ``content``. Returns {"citations": [...verdicts], "malformedCount": int}.
    """
    pattern = contract.citation_pattern
    citations: list[dict[str, Any]] = []
    malformed = 0
    for raw_line in reply.split("\n"):
        line = raw_line.rstrip()
        if not line.lstrip().startswith(">"):
            continue
        match = pattern.match(line)
        if not match:
            malformed += 1
            continue
        name, quote = match.group(1), match.group(2)
        flat_quote = _flatten(quote)
        named = [s for s in sources if s["documentName"] == name]
        verbatim = bool(flat_quote) and any(
            flat_quote in _flatten(s.get("normalized") or s["content"]) for s in named
        )
        within = len(flat_quote) <= contract.max_quote_chars
        citations.append(
            {
                "documentName": name,
                "quote": quote,
                "knownDocument": bool(named),
                "verbatim": verbatim,
                "withinLength": within,
                "valid": bool(named) and verbatim and within,
            }
        )
    return {"citations": citations, "malformedCount": malformed}
