#!/usr/bin/env python3
"""
CI/CD Threshold Check for Export Risk Classification

Validates that classification metrics meet CI/CD quality gates.
Returns structured JSON result and appropriate exit code for pipeline integration.

Usage:
    # Full flow: run eval then check threshold
    uv run ci_check.py --eval dataset.yaml --threshold 0.95 --check-class High

    # Check existing aggregator results file
    uv run ci_check.py metrics.aggregators.json --threshold 0.95 --check-class High

Options:
    --eval FILE         Run agentv eval on this dataset first
    --threshold FLOAT   F1 score threshold (default: 0.95)
    --check-class STR   Risk class to check (default: High)
    --output FILE       Output JSON file (optional, prints to stdout if omitted)

Exit Codes:
    0 - Pass (F1 >= threshold)
    1 - Fail (F1 < threshold)
"""

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path


def run_eval(eval_file: Path) -> Path:
    """
    Run agentv eval with confusion-matrix aggregator and return path to aggregator results.

    Raises SystemExit on failure.
    """
    # Create temp file for results
    results_file = Path(tempfile.mktemp(suffix=".jsonl"))
    aggregator_file = Path(str(results_file).replace(".jsonl", ".aggregators.json"))

    # Find repo root (look for package.json with workspaces)
    repo_root = eval_file.resolve().parent
    while repo_root != repo_root.parent:
        if (repo_root / "package.json").exists():
            pkg = json.loads((repo_root / "package.json").read_text())
            if "workspaces" in pkg:
                break
        repo_root = repo_root.parent
    else:
        repo_root = Path.cwd()

    # Run agentv eval with confusion-matrix aggregator
    cmd = [
        "bun", "agentv", "eval",
        str(eval_file.resolve()),
        "--out", str(results_file),
        "--aggregator", "confusion-matrix"
    ]

    print(f"Running: {' '.join(cmd)}", file=sys.stderr)
    print(f"Working directory: {repo_root}", file=sys.stderr)

    try:
        result = subprocess.run(
            cmd,
            cwd=repo_root,
            capture_output=True,
            text=True
        )

        if result.returncode != 0:
            print(f"Error running agentv eval:", file=sys.stderr)
            print(result.stderr, file=sys.stderr)
            sys.exit(1)

        # Print eval output to stderr
        if result.stdout:
            print(result.stdout, file=sys.stderr)

    except FileNotFoundError:
        print("Error: 'bun' command not found. Ensure bun is installed.", file=sys.stderr)
        sys.exit(1)

    if not aggregator_file.exists():
        print(f"Error: Eval did not produce aggregator file: {aggregator_file}", file=sys.stderr)
        sys.exit(1)

    return aggregator_file


def load_metrics(aggregator_file: Path) -> dict:
    """Load metrics from aggregator JSON file."""
    try:
        data = json.loads(aggregator_file.read_text())
        # The aggregator output is an array; find confusion-matrix result
        for item in data:
            if item.get("type") == "confusion-matrix":
                return item
        return {"error": "No confusion-matrix aggregator found in results"}
    except json.JSONDecodeError as e:
        return {"error": f"Failed to parse aggregator JSON: {e}"}


def check_threshold(
    metrics: dict,
    check_class: str,
    threshold: float
) -> dict:
    """
    Check if target class F1 meets threshold.

    Returns structured result for CI/CD pipelines.
    """
    per_class = metrics.get("metricsPerClass", {})
    class_metrics = per_class.get(check_class, {})
    actual_f1 = class_metrics.get("f1", 0.0)

    passed = actual_f1 >= threshold

    return {
        "result": "pass" if passed else "fail",
        "checkedClass": check_class,
        "threshold": threshold,
        "actualF1": actual_f1,
        "margin": round(actual_f1 - threshold, 4),
        "message": (
            f"PASS: {check_class} F1 score {actual_f1:.1%} >= {threshold:.1%} threshold"
            if passed else
            f"FAIL: {check_class} F1 score {actual_f1:.1%} < {threshold:.1%} threshold"
        ),
        "metrics": metrics
    }


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="CI/CD threshold check for export risk classification",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exit Codes:
  0  Pass (F1 >= threshold)
  1  Fail (F1 < threshold)

Examples:
  # Full flow - run eval then check
  uv run ci_check.py --eval dataset.yaml --threshold 0.95

  # Check existing aggregator results
  uv run ci_check.py metrics.aggregators.json --threshold 0.95
        """
    )
    parser.add_argument(
        "aggregator_file",
        type=Path,
        nargs="?",
        help="AgentV aggregator JSON file (optional if --eval is provided)"
    )
    parser.add_argument(
        "--eval",
        dest="eval_file",
        type=Path,
        help="Run agentv eval on this dataset file first"
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.95,
        help="F1 score threshold (default: 0.95)"
    )
    parser.add_argument(
        "--check-class",
        dest="check_class",
        choices=["Low", "Medium", "High"],
        default="High",
        help="Risk class to check (default: High)"
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Output JSON file (prints to stdout if omitted)"
    )

    args = parser.parse_args()

    # Determine aggregator file
    if args.eval_file:
        if not args.eval_file.exists():
            print(f"Error: Eval file not found: {args.eval_file}", file=sys.stderr)
            sys.exit(1)
        aggregator_file = run_eval(args.eval_file)
    elif args.aggregator_file:
        if not args.aggregator_file.exists():
            print(f"Error: Aggregator file not found: {args.aggregator_file}", file=sys.stderr)
            sys.exit(1)
        aggregator_file = args.aggregator_file
    else:
        print("Error: Provide either --eval <dataset.yaml> or <aggregators.json>", file=sys.stderr)
        sys.exit(1)

    # Load metrics from aggregator output
    metrics = load_metrics(aggregator_file)

    if "error" in metrics:
        print(f"Error: {metrics['error']}", file=sys.stderr)
        sys.exit(1)

    # Check threshold
    result = check_threshold(metrics, args.check_class, args.threshold)

    # Output JSON
    output_json = json.dumps(result, indent=2)

    if args.output:
        args.output.write_text(output_json)
        print(f"Result written to: {args.output}", file=sys.stderr)
    else:
        print(output_json)

    # Print summary to stderr
    print(f"\n{result['message']}", file=sys.stderr)

    # Exit with appropriate code
    sys.exit(0 if result["result"] == "pass" else 1)


if __name__ == "__main__":
    main()
