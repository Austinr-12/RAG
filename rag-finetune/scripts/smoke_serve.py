"""Phase 0 seam check: stream the contract's golden prompts through a served
model and verify the replies with the app's own citation rule.

    python scripts/smoke_serve.py                 # vLLM at localhost:8000, model rag-grounded
    python scripts/smoke_serve.py --openai        # gpt-4o-mini through the same client
    python scripts/smoke_serve.py --all           # include the no-sources prompt
    python scripts/smoke_serve.py --json outputs/smoke/serve.json

Exit code 1 when any answerable golden prompt gets no valid citation, so the
script doubles as a gate.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ragft.client import ChatClient, Endpoint  # noqa: E402
from ragft.contract import build_messages, load_contract, scan_citations  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://127.0.0.1:8000/v1")
    ap.add_argument("--model", default="rag-grounded")
    ap.add_argument("--api-key", default="dev")
    ap.add_argument("--openai", action="store_true", help="call api.openai.com gpt-4o-mini instead")
    ap.add_argument("--all", action="store_true", help="include the no-sources golden prompt")
    ap.add_argument("--json", type=Path, help="write results as JSON here")
    args = ap.parse_args()

    contract = load_contract()
    if args.openai:
        endpoint = Endpoint.openai()
    else:
        endpoint = Endpoint.vllm(args.model, args.base_url, args.api_key)
    client = ChatClient(endpoint, contract)
    print(f"endpoint: {endpoint.base_url or 'api.openai.com'} model={endpoint.model}")
    print(
        f"contract sha256: {contract.sha256[:12]}  "
        f"temperature={contract.temperature} max_tokens={contract.max_output_tokens}"
    )
    print(f"served models: {client.list_models()}\n")

    failures = 0
    results = []
    for golden in contract.raw["goldenPrompts"]:
        answerable = bool(golden["sources"])
        if not answerable and not args.all:
            continue
        messages = build_messages(contract, golden["question"], golden["sources"])
        result = client.complete(messages, seed=0)
        scan = scan_citations(contract, result.text, golden["sources"])
        valid = sum(1 for c in scan["citations"] if c["valid"])
        ok = (valid > 0) if answerable else (len(scan["citations"]) == 0)
        failures += 0 if ok else 1
        ttft = f"{result.ttft_s:.2f}s" if result.ttft_s is not None else "n/a"
        print("=" * 72)
        print(
            f"[{golden['name']}] answerable={answerable} ttft={ttft} total={result.total_s:.2f}s "
            f"tokens={result.prompt_tokens}+{result.completion_tokens} finish={result.finish_reason}"
        )
        print("-" * 72)
        print(result.text.strip())
        print("-" * 72)
        for c in scan["citations"]:
            flag = "OK " if c["valid"] else "BAD"
            print(
                f"  {flag} {c['documentName']!r} known={c['knownDocument']} "
                f"verbatim={c['verbatim']} len_ok={c['withinLength']}"
            )
        verdict = "PASS" if ok else "FAIL"
        print(f"  valid={valid}/{len(scan['citations'])} malformed={scan['malformedCount']} -> {verdict}\n")
        results.append(
            {"name": golden["name"], "answerable": answerable, "pass": ok, "scan": scan, **result.as_dict()}
        )

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        payload = {"contract_sha256": contract.sha256, "endpoint": endpoint.__dict__, "results": results}
        args.json.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"wrote {args.json}")
    print("ALL PASS" if failures == 0 else f"{failures} FAILED")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
