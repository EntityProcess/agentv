# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "datasets>=2.14.0",
#     "pyyaml>=6.0",
# ]
# ///
"""
HuggingFace dataset importer for AgentV.

Downloads a dataset from HuggingFace Hub and converts each instance to an
AgentV EVAL.yaml file. Currently supports SWE-bench-style datasets.

Usage (via uv):
    uv run scripts/import-huggingface.py \
        --repo SWE-bench/SWE-bench_Verified \
        --split test \
        --limit 10 \
        --output evals/swebench/

SWE-bench field mapping:
    instance_id        -> test id
    problem_statement  -> input (user message)
    repo + base_commit -> workspace.docker metadata
    FAIL_TO_PASS       -> assertions (code-grader commands)
    difficulty         -> metadata.difficulty

To support a new dataset schema:
    1. Add a detect function (like _is_swebench)
    2. Add a converter function (like _convert_swebench_instance)
    3. Register it in SCHEMA_CONVERTERS
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

import yaml


# ---------------------------------------------------------------------------
# SWE-bench schema detection & conversion
# ---------------------------------------------------------------------------

def _is_swebench(columns: list[str]) -> bool:
    """Return True if the dataset columns match SWE-bench schema."""
    required = {"instance_id", "problem_statement", "repo", "base_commit"}
    return required.issubset(set(columns))


def _sanitize_id(instance_id: str) -> str:
    """Convert a SWE-bench instance_id to a safe filename component.

    Example: 'django__django-16527' -> 'django__django-16527'
    Strips characters that are unsafe in filenames.
    """
    return re.sub(r"[^\w\-.]", "_", instance_id)


def _to_eval_name(instance_id: str) -> str:
    """Convert an instance_id to an AgentV eval name (lowercase, alphanumeric + hyphens).

    AgentV name field must match /^[a-z0-9-]+$/.
    Example: 'astropy__astropy-12907' -> 'astropy-astropy-12907'
    """
    name = instance_id.lower()
    # Replace underscores, dots, and other non-alphanumeric chars with hyphens
    name = re.sub(r"[^a-z0-9-]", "-", name)
    # Collapse consecutive hyphens
    name = re.sub(r"-{2,}", "-", name)
    # Strip leading/trailing hyphens
    return name.strip("-")


def _docker_image_for_repo(repo: str) -> str:
    """Derive a Docker image name for a SWE-bench repo.

    Uses the swebench Docker image naming convention:
    swebench/sweb.eval.<owner>__<repo>:latest
    """
    # repo format: "owner/name" e.g. "django/django"
    safe = repo.replace("/", "__")
    return f"swebench/sweb.eval.{safe}:latest"


def _parse_test_list(value: Any) -> list[str]:
    """Parse FAIL_TO_PASS or PASS_TO_PASS from a SWE-bench row.

    The field may be a JSON-encoded list string, a Python list, or absent.
    """
    if value is None:
        return []
    if isinstance(value, list):
        return [str(t) for t in value]
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return [str(t) for t in parsed]
        except (json.JSONDecodeError, TypeError):
            pass
        # Fallback: comma-separated
        return [t.strip() for t in value.split(",") if t.strip()]
    return []


def _convert_swebench_instance(row: dict[str, Any]) -> dict[str, Any]:
    """Convert a single SWE-bench row to an AgentV EVAL.yaml dict."""
    instance_id = str(row.get("instance_id", "unknown"))
    problem_statement = str(row.get("problem_statement", ""))
    repo = str(row.get("repo", ""))
    base_commit = str(row.get("base_commit", ""))
    fail_to_pass = _parse_test_list(row.get("FAIL_TO_PASS"))
    pass_to_pass = _parse_test_list(row.get("PASS_TO_PASS"))
    difficulty = row.get("difficulty")

    # Build assertions from FAIL_TO_PASS and PASS_TO_PASS test names
    assertions: list[dict[str, Any]] = []
    if fail_to_pass:
        # Code-grader that runs the previously-failing tests (should pass after patch)
        assertions.append({
            "type": "code-grader",
            "command": [
                "python", "-c",
                (
                    "import subprocess, sys, json; "
                    f"result = subprocess.run({json.dumps(['python', '-m', 'pytest'] + fail_to_pass)}, "
                    "capture_output=True, text=True); "
                    "passed = result.returncode == 0; "
                    "print(json.dumps({'score': 1.0 if passed else 0.0, "
                    "'assertions': [{'text': 'FAIL_TO_PASS tests pass after patch', 'passed': passed, "
                    "'evidence': result.stdout[-500:] if result.stdout else result.stderr[-500:]}]}))"
                ),
            ],
        })
    if pass_to_pass:
        # Code-grader that verifies existing passing tests still pass (no regression)
        assertions.append({
            "type": "code-grader",
            "command": [
                "python", "-c",
                (
                    "import subprocess, sys, json; "
                    f"result = subprocess.run({json.dumps(['python', '-m', 'pytest'] + pass_to_pass)}, "
                    "capture_output=True, text=True); "
                    "passed = result.returncode == 0; "
                    "print(json.dumps({'score': 1.0 if passed else 0.0, "
                    "'assertions': [{'text': 'PASS_TO_PASS tests still pass (no regression)', 'passed': passed, "
                    "'evidence': result.stdout[-500:] if result.stdout else result.stderr[-500:]}]}))"
                ),
            ],
        })

    # Build the test case
    test_case: dict[str, Any] = {
        "id": instance_id,
        "input": problem_statement,
    }

    if assertions:
        test_case["assertions"] = assertions

    # Add metadata
    metadata: dict[str, Any] = {}
    if repo:
        metadata["repo"] = repo
    if base_commit:
        metadata["base_commit"] = base_commit
    if difficulty is not None:
        metadata["difficulty"] = str(difficulty)
    if metadata:
        test_case["metadata"] = metadata

    # Build the eval document
    eval_doc: dict[str, Any] = {
        "name": _to_eval_name(instance_id),
        "description": f"SWE-bench eval for {instance_id}",
    }

    # Docker workspace config
    if repo:
        eval_doc["workspace"] = {
            "docker": {
                "image": _docker_image_for_repo(repo),
                "timeout": 600,
                "memory": "4g",
            },
        }

    eval_doc["tests"] = [test_case]

    return eval_doc


# ---------------------------------------------------------------------------
# Schema converter registry
# ---------------------------------------------------------------------------

# Each entry: (detect_fn, convert_fn)
# detect_fn receives column names, convert_fn receives a single row dict.
SCHEMA_CONVERTERS = [
    (_is_swebench, _convert_swebench_instance),
]


def _detect_converter(columns: list[str]):
    """Find the first matching schema converter for the given columns."""
    for detect_fn, convert_fn in SCHEMA_CONVERTERS:
        if detect_fn(columns):
            return convert_fn
    return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import a HuggingFace dataset into AgentV EVAL.yaml format",
    )
    parser.add_argument(
        "--repo",
        required=True,
        help="HuggingFace dataset repository (e.g. SWE-bench/SWE-bench_Verified)",
    )
    parser.add_argument(
        "--split",
        default="test",
        help="Dataset split to load (default: test)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of instances to import",
    )
    parser.add_argument(
        "--output",
        default="evals/",
        help="Output directory for EVAL.yaml files (default: evals/)",
    )

    args = parser.parse_args()

    if args.limit is not None and args.limit <= 0:
        parser.error("--limit must be a positive integer")

    # Import datasets here so uv can auto-install the dependency
    try:
        from datasets import load_dataset
    except ImportError:
        print(
            "Error: the 'datasets' package is not installed.\n"
            "Run this script via `uv run` (which auto-installs dependencies) or:\n"
            "  pip install datasets>=2.14.0",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"Loading dataset {args.repo} (split={args.split})...", file=sys.stderr)

    try:
        dataset = load_dataset(args.repo, split=args.split)
    except Exception as e:
        print(f"Error loading dataset: {e}", file=sys.stderr)
        sys.exit(1)

    columns = dataset.column_names
    converter = _detect_converter(columns)

    if converter is None:
        print(
            f"Error: Unsupported dataset schema. Columns: {columns}\n"
            "Currently supported: SWE-bench (requires instance_id, problem_statement, repo, base_commit)",
            file=sys.stderr,
        )
        sys.exit(1)

    # Apply limit
    total = len(dataset)
    if args.limit is not None and args.limit < total:
        dataset = dataset.select(range(args.limit))
        total = args.limit

    print(f"Converting {total} instances...", file=sys.stderr)

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    created = 0
    for row in dataset:
        eval_doc = converter(dict(row))
        # Use the test id (original instance_id) for the filename, not the
        # sanitized eval name, so filenames remain recognizable.
        test_id = eval_doc["tests"][0]["id"] if eval_doc.get("tests") else eval_doc.get("name", f"instance-{created}")
        safe_id = _sanitize_id(test_id)
        file_path = output_dir / f"{safe_id}.EVAL.yaml"

        with open(file_path, "w") as f:
            yaml.dump(
                eval_doc,
                f,
                default_flow_style=False,
                sort_keys=False,
                allow_unicode=True,
                width=120,
            )
        created += 1

    print(f"Created {created} EVAL.yaml files in {output_dir}/", file=sys.stderr)

    # Print summary to stdout as JSON for programmatic consumption
    summary = {
        "dataset": args.repo,
        "split": args.split,
        "total_instances": total,
        "files_created": created,
        "output_dir": str(output_dir),
    }
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
