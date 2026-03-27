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
import os
import shutil
import subprocess
import sys
from pathlib import Path


def _find_env_key(key: str) -> str | None:
    """Search up from cwd for .env and return a specific key value."""
    current = Path(os.getcwd())
    while True:
        env_file = current / ".env"
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                line = line.strip()
                if line.startswith(f"{key}="):
                    return line[len(key) + 1:]
        parent = current.parent
        if parent == current:
            break
        current = parent
    return None


def _find_agentv() -> list[str]:
    """Resolve the agentv CLI command.

    Checks AGENTV_CLI env var first (supports multi-word commands like
    'bun /path/to/cli.ts' for running from source). If not in environment,
    also searches the nearest .env file. Falls back to PATH lookup.
    """
    cli = os.environ.get("AGENTV_CLI") or _find_env_key("AGENTV_CLI")
    if cli:
        parts = cli.split()
        if parts:
            return parts
    path = shutil.which("agentv")
    if not path:
        print(
            "agentv CLI not found. Set AGENTV_CLI in .env or install: bun install -g agentv",
            file=sys.stderr,
        )
        sys.exit(1)
    return [path]


def main():
    parser = argparse.ArgumentParser(description="Run code-grader assertions")
    parser.add_argument("export_dir", help="Export directory from pipeline input")
    args = parser.parse_args()

    result = subprocess.run(
        [*_find_agentv(), "pipeline", "grade", args.export_dir],
        capture_output=False,
    )
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
