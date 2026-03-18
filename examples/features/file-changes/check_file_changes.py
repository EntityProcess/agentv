#!/usr/bin/env python3
"""
Code grader that verifies file_changes captures edits, creates, and deletes.

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

    assertions = []

    if not file_changes:
        assertions.append({"text": "file_changes is empty or missing", "passed": False})
        print(json.dumps({"score": 0, "assertions": assertions}))
        return 0

    # Check unified diff format
    if "diff --git" in file_changes:
        assertions.append({"text": "file_changes contains unified diff format", "passed": True})
    else:
        assertions.append({"text": "file_changes does not contain unified diff markers", "passed": False})

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
            assertions.append({"text": f"edit detected: {path}", "passed": True})
        else:
            assertions.append({"text": f"edit NOT detected: {path}", "passed": False})

    for path in config.get("expect_created", []):
        found = any(
            f"b/{path}" in block and "--- /dev/null" in block
            for block in diff_blocks
        )
        if found:
            assertions.append({"text": f"create detected: {path}", "passed": True})
        else:
            assertions.append({"text": f"create NOT detected: {path}", "passed": False})

    for path in config.get("expect_deleted", []):
        found = any(
            f"a/{path}" in block and "+++ /dev/null" in block
            for block in diff_blocks
        )
        if found:
            assertions.append({"text": f"delete detected: {path}", "passed": True})
        else:
            assertions.append({"text": f"delete NOT detected: {path}", "passed": False})

    passed = sum(1 for a in assertions if a["passed"])
    total = len(assertions)
    score = passed / total if total > 0 else 0

    result = {
        "score": score,
        "assertions": assertions,
    }
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
