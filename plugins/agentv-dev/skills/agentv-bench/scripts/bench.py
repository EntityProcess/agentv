#!/usr/bin/env python3
"""
Merge evaluator scores and produce final benchmark artifacts.

Calls `agentv pipeline bench` to merge code-grader results with LLM grader
scores, compute weighted pass_rate, and write grading.json + index.jsonl +
benchmark.json.

Usage:
    python bench.py <export-dir> < llm_scores.json
    echo '{"test-01": {"relevance": {"score": 0.8, ...}}}' | python bench.py <export-dir>

Example:
    python bench.py .agentv/results/export/run-1 < llm_scores.json

Stdin format (LLM grader scores):
    {
      "<test-id>": {
        "<grader-name>": {
          "score": 0.85,
          "assertions": [{"text": "...", "passed": true, "evidence": "..."}]
        }
      }
    }

Output:
    <export-dir>/index.jsonl       <- per-test manifest
    <export-dir>/benchmark.json    <- aggregate statistics
    <export-dir>/<test-id>/grading.json <- merged grading per test
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
    parser = argparse.ArgumentParser(
        description="Merge scores and produce benchmark artifacts"
    )
    parser.add_argument("export_dir", help="Export directory")
    args = parser.parse_args()

    # Pass stdin through to agentv pipeline bench
    result = subprocess.run(
        [*_find_agentv(), "pipeline", "bench", args.export_dir],
        stdin=sys.stdin,
    )
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
