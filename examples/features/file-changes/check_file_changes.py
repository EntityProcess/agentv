#!/usr/bin/env python3
"""
Code judge that verifies file_changes captures edits, creates, and deletes.

Reads the evaluation payload from stdin. Uses pass-through config properties
to know which files to expect in each category:
  - expect_edited:  files that should appear as modified (--- a/... +++ b/...)
  - expect_created: files that should appear as new      (--- /dev/null +++ b/...)
  - expect_deleted: files that should appear as removed  (--- a/... +++ /dev/null)
"""
import json
import re
import sys


def main() -> int:
    payload = json.load(sys.stdin)
    config = payload.get("config", {}) or {}
    file_changes = payload.get("file_changes") or ""

    hits = []
    misses = []

    if not file_changes:
        misses.append("file_changes is empty or missing")
        print(json.dumps({"score": 0, "hits": hits, "misses": misses, "reasoning": "No file changes captured"}))
        return 0

    # Check unified diff format
    if "diff --git" in file_changes:
        hits.append("file_changes contains unified diff format")
    else:
        misses.append("file_changes does not contain unified diff markers")

    # Split into individual diff blocks
    diff_blocks = re.split(r"(?=^diff --git )", file_changes, flags=re.MULTILINE)

    for path in config.get("expect_edited", []):
        found = any(
            f"a/{path}" in block and f"b/{path}" in block
            and "--- /dev/null" not in block
            and "+++ /dev/null" not in block
            for block in diff_blocks
        )
        if found:
            hits.append(f"edit detected: {path}")
        else:
            misses.append(f"edit NOT detected: {path}")

    for path in config.get("expect_created", []):
        found = any(
            f"b/{path}" in block and "--- /dev/null" in block
            for block in diff_blocks
        )
        if found:
            hits.append(f"create detected: {path}")
        else:
            misses.append(f"create NOT detected: {path}")

    for path in config.get("expect_deleted", []):
        found = any(
            f"a/{path}" in block and "+++ /dev/null" in block
            for block in diff_blocks
        )
        if found:
            hits.append(f"delete detected: {path}")
        else:
            misses.append(f"delete NOT detected: {path}")

    total = len(hits) + len(misses)
    score = len(hits) / total if total > 0 else 0

    result = {
        "score": score,
        "hits": hits,
        "misses": misses,
        "reasoning": f"{len(hits)}/{total} checks passed",
    }
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
