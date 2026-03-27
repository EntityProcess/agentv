#!/usr/bin/env python3
"""
Run code-grader assertions on existing responses.

Calls `agentv pipeline grade` to execute all code-grader assertions declared in
the eval against response.md files in the export directory.

Usage:
    python run_code_graders.py <export-dir>

Example:
    python run_code_graders.py .agentv/results/export/run-1

Prerequisites:
    - `agentv pipeline input` has been run (or run_tests.py)
    - response.md exists in each test directory

Output:
    <export-dir>/<test-id>/code_grader_results/<name>.json
"""
import argparse
import shutil
import subprocess
import sys


def _find_agentv() -> str:
    """Resolve the agentv executable via PATH (handles .ps1/.cmd on Windows)."""
    path = shutil.which("agentv")
    if not path:
        print("agentv CLI not found. Install: bun install -g agentv", file=sys.stderr)
        sys.exit(1)
    return path


def main():
    parser = argparse.ArgumentParser(description="Run code-grader assertions")
    parser.add_argument("export_dir", help="Export directory from pipeline input")
    args = parser.parse_args()

    result = subprocess.run(
        [_find_agentv(), "pipeline", "grade", args.export_dir],
        capture_output=False,
    )
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
