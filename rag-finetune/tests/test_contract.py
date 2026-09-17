"""The Python half of the contract guard.

The app's vitest suite fails when contract/prompt-contract.json goes stale.
This suite fails when the Python renderer or citation checker stops matching
the app. Together they guarantee train, eval and production see the same thing.

Run with either:
    python -m pytest tests/test_contract.py
    python tests/test_contract.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ragft.contract import (  # noqa: E402
    build_messages,
    compute_sha256,
    load_contract,
    render_prompt,
    scan_citations,
)


def test_contract_loads_and_hash_is_recomputable():
    contract = load_contract()
    assert compute_sha256(contract.raw) == contract.sha256


def test_render_prompt_matches_the_app_byte_for_byte():
    contract = load_contract()
    assert contract.raw["goldenPrompts"], "contract has no golden prompts"
    for golden in contract.raw["goldenPrompts"]:
        assert render_prompt(golden["question"], golden["sources"]) == golden["rendered"], golden["name"]


def test_citation_verdicts_match_the_app():
    contract = load_contract()
    assert contract.raw["goldenCitations"], "contract has no golden citations"
    for golden in contract.raw["goldenCitations"]:
        got = scan_citations(contract, golden["reply"], golden["sources"])
        assert got == golden["expected"], golden["name"]


def test_system_prompt_example_is_a_valid_citation_line():
    contract = load_contract()
    example = contract.system_prompt.split("\n")[-1]
    assert contract.citation_pattern.match(example)


def test_message_layout():
    contract = load_contract()
    history = [
        {"role": "user", "content": "How long is the warranty?"},
        {"role": "assistant", "content": "One year."},
    ]
    sources = [{"documentName": "a.md", "normalized": "Battery lasts 1,000 cycles."}]
    messages = build_messages(contract, "And the battery?", sources, history)
    assert [m["role"] for m in messages] == ["system", "user", "assistant", "user"]
    assert messages[0]["content"] == contract.system_prompt
    assert messages[1]["content"] == "How long is the warranty?"
    assert messages[-1]["content"].endswith("Question: And the battery?\n\nAnswer:")


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for test in tests:
        test()
        print(f"ok  {test.__name__}")
    print(f"{len(tests)} passed - contract sha256 {load_contract().sha256}")
