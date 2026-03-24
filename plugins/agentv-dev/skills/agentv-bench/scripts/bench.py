#!/usr/bin/env python3
"""
Merge evaluator scores and produce final benchmark artifacts.

Calls `agentv eval bench` to merge code-grader results with LLM grader
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
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(
        description="Merge scores and produce benchmark artifacts"
    )
    parser.add_argument("export_dir", help="Export directory")
    args = parser.parse_args()

    # Pass stdin through to agentv eval bench
    result = subprocess.run(
        ["agentv", "eval", "bench", args.export_dir],
        stdin=sys.stdin,
    )
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
