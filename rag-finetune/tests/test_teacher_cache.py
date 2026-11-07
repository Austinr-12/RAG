"""ResponseCache is shared by the builder's worker threads: concurrent puts
must all reach the file and the counters must add up (no network).

    python tests/test_teacher_cache.py
"""

from __future__ import annotations

import sys
import tempfile
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ragft.teacher import ResponseCache  # noqa: E402


def test_concurrent_puts_all_land_and_counters_add_up():
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "cache.jsonl"
        cache = ResponseCache(path)

        def worker(w: int) -> None:
            for i in range(50):
                cache.put(f"k{w}-{i}", f"v{w}-{i}")

        threads = [threading.Thread(target=worker, args=(w,)) for w in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert cache.misses == 400 and cache.hits == 0
        assert cache.get("k3-7") == "v3-7" and cache.hits == 1
        assert cache.get("nope") is None and cache.hits == 1
        assert len(path.read_text(encoding="utf-8").splitlines()) == 400
        reloaded = ResponseCache(path)
        assert reloaded.get("k7-49") == "v7-49" and reloaded.hits == 1


def test_key_ignores_option_order_and_is_a_sha256():
    msgs = [{"role": "user", "content": "x"}]
    a = ResponseCache.key("m", msgs, temperature=0.2, seed=0)
    b = ResponseCache.key("m", msgs, seed=0, temperature=0.2)
    assert a == b and len(a) == 64
    assert ResponseCache.key("m", msgs, seed=1) != a


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for test in tests:
        test()
        print(f"ok  {test.__name__}")
    print(f"{len(tests)} passed")
