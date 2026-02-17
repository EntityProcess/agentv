#!/usr/bin/env python3
"""
Code judge that verifies file_changes are captured correctly.
Reads the evaluation payload from stdin and checks that the unified diff
contains the expected file modifications.
"""
import json
import sys


def main() -> int:
    payload = json.load(sys.stdin)

    file_changes = payload.get("file_changes", None)
    hits = []
    misses = []

    if file_changes is None or file_changes == "":
        misses.append("file_changes is empty or missing")
    else:
        # Check that the diff mentions hello.txt modification
        if "hello.txt" in file_changes:
            hits.append("hello.txt modification detected in file_changes")
        else:
            misses.append("hello.txt modification NOT found in file_changes")

        # Check that the diff mentions result.txt creation
        if "result.txt" in file_changes:
            hits.append("result.txt creation detected in file_changes")
        else:
            misses.append("result.txt creation NOT found in file_changes")

        # Check it looks like a unified diff
        if "diff --git" in file_changes or "+++" in file_changes:
            hits.append("file_changes contains unified diff format")
        else:
            misses.append("file_changes does not look like a unified diff")

    score = len(hits) / max(len(hits) + len(misses), 1)

    result = {
        "score": score,
        "hits": hits,
        "misses": misses,
        "reasoning": f"file_changes captured: {file_changes is not None and len(file_changes) > 0}",
    }

    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
