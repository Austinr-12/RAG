"""Load the exported corpus (app chunks + manifest) into documents and libraries.

The app's ``npm run export:corpus`` writes one row per chunk:
``{documentName, chunkIndex, chunkCount, content, normalized}``. The manifest
(``data/corpus-manifest.json``) says which library each file belongs to, its
title and its license. This module joins the two and adds what the dataset
builder needs: neighbor links (chunks overlap by 200 characters, so chunk
``i`` shares text with ``i-1`` and ``i+1``) and the two display styles for a
document name (the filename the app actually shows, or a title).

Stdlib only. Nothing here calls a model.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Iterator

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CHUNKS = ROOT / "data" / "generated" / "chunks.jsonl"
DEFAULT_MANIFEST = ROOT / "data" / "corpus-manifest.json"

_PART_RE = re.compile(r"^(.*)-part(\d+)of(\d+)(\.[^.]+)$")


@dataclass(frozen=True)
class Chunk:
    document: str  # filename as the app shows it (documentName)
    library: str
    index: int
    count: int
    content: str
    normalized: str

    @property
    def key(self) -> tuple[str, int]:
        return (self.document, self.index)


@dataclass
class Document:
    filename: str
    library: str
    title: str
    manifest_id: str
    license: str
    chunks: list[Chunk] = field(default_factory=list)

    def neighbors(self, chunk: Chunk) -> list[Chunk]:
        """Chunks that share overlapping text with ``chunk`` (index ±1)."""
        return [c for c in self.chunks if abs(c.index - chunk.index) == 1]

    def display_name(self, style: str) -> str:
        """``"filename"`` is what production shows; ``"title"`` mimics users who
        rename uploads. Split parts keep their part label in the title form."""
        if style == "filename":
            return self.filename
        m = _PART_RE.match(self.filename)
        if m:
            return f"{self.title} (part {int(m.group(2))} of {int(m.group(3))})"
        return self.title


def manifest_filename(name: str) -> str:
    """Map a ``-partNofM`` filename back to the manifest entry's filename."""
    m = _PART_RE.match(name)
    return f"{m.group(1)}{m.group(4)}" if m else name


class Corpus:
    def __init__(self, documents: Iterable[Document]):
        self.documents: dict[str, Document] = {d.filename: d for d in documents}
        self.libraries: dict[str, list[Document]] = {}
        for d in self.documents.values():
            self.libraries.setdefault(d.library, []).append(d)
        for docs in self.libraries.values():
            docs.sort(key=lambda d: d.filename)
        self._by_key: dict[tuple[str, int], Chunk] = {
            c.key: c for d in self.documents.values() for c in d.chunks
        }

    @classmethod
    def load(cls, chunks_path: Path | str = DEFAULT_CHUNKS, manifest_path: Path | str = DEFAULT_MANIFEST) -> "Corpus":
        manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
        entries = {e["filename"]: e for e in manifest["documents"]}
        docs: dict[str, Document] = {}
        with Path(chunks_path).open(encoding="utf-8") as fh:
            for line in fh:
                if not line.strip():
                    continue
                row = json.loads(line)
                name = row["documentName"]
                entry = entries.get(manifest_filename(name))
                if entry is None:
                    raise ValueError(f"{name} is not in the manifest; re-run fetch_corpus.py or fix the manifest")
                doc = docs.get(name)
                if doc is None:
                    doc = docs[name] = Document(
                        filename=name,
                        library=entry["library"],
                        title=entry["title"],
                        manifest_id=entry["id"],
                        license=entry["license"],
                    )
                doc.chunks.append(
                    Chunk(
                        document=name,
                        library=entry["library"],
                        index=int(row["chunkIndex"]),
                        count=int(row["chunkCount"]),
                        content=row["content"],
                        normalized=row["normalized"],
                    )
                )
        for doc in docs.values():
            doc.chunks.sort(key=lambda c: c.index)
        return cls(docs.values())

    def chunk(self, key: tuple[str, int]) -> Chunk:
        return self._by_key[key]

    def document_of(self, chunk: Chunk) -> Document:
        return self.documents[chunk.document]

    def chunks(self, library: str | None = None) -> Iterator[Chunk]:
        docs = self.libraries[library] if library else self.documents.values()
        for d in docs:
            yield from d.chunks

    def summary(self) -> dict:
        return {
            "documents": len(self.documents),
            "libraries": {lib: {"documents": len(ds), "chunks": sum(len(d.chunks) for d in ds)} for lib, ds in sorted(self.libraries.items())},
            "chunks": sum(len(d.chunks) for d in self.documents.values()),
        }
