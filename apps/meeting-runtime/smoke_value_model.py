"""Run concise, real-weight MiniCPM5 value-filter smoke checks."""

from __future__ import annotations

import json
import sys
import time

import server


CASES = [
    ("周三前完成发布方案。", True),
    ("今天天气不错，午饭吃什么？", False),
]
CONTEXT = "组织正在准备周五发布。"


def main() -> int:
    started = time.monotonic()
    failures = 0
    for transcript, expected in CASES:
        verdict = server.judge(transcript, CONTEXT)
        passed = verdict["valuable"] is expected
        failures += 0 if passed else 1
        print(json.dumps({
            "passed": passed,
            "expectedValuable": expected,
            "transcript": transcript,
            "verdict": verdict,
        }, ensure_ascii=False))
    print(json.dumps({
        "passed": failures == 0,
        "cases": len(CASES),
        "elapsedSec": round(time.monotonic() - started, 2),
        "device": server.VALUE_DEVICE,
        "model": server.VALUE_MODEL,
    }, ensure_ascii=False))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
