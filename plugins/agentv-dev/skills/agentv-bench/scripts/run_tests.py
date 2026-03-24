#!/usr/bin/env python3
"""
Run eval test cases by extracting inputs and invoking CLI targets.

Calls `agentv pipeline input` to extract inputs, then invokes each test's CLI
target command in parallel, writing response.md per test.

Usage:
    python run_tests.py <eval-path> --out <dir> [--workers N]

Example:
    python run_tests.py evals/repro.eval.yaml --out .agentv/results/export/run-1

Output structure:
    <out-dir>/
    ├── manifest.json          ← from agentv pipeline input
    ├── <test-id>/
    │   ├── input.json         ← from agentv pipeline input
    │   ├── invoke.json        ← from agentv pipeline input
    │   ├── response.md        ← target output (written by this script)
    │   └── timing.json        ← execution timing (written by this script)

For agent-as-target mode (invoke.json has kind=agent), this script only runs
`agentv pipeline input`. The agent handles execution directly.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


def run_agentv_input(eval_path: str, out_dir: str) -> dict:
    """Call agentv pipeline input and return the manifest."""
    result = subprocess.run(
        ["agentv", "pipeline", "input", eval_path, "--out", out_dir],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"agentv pipeline input failed:\n{result.stderr}", file=sys.stderr)
        sys.exit(1)
    manifest_path = Path(out_dir) / "manifest.json"
    return json.loads(manifest_path.read_text())


def invoke_cli_target(test_dir: Path) -> None:
    """Read invoke.json and execute the CLI target command."""
    invoke_path = test_dir / "invoke.json"
    invoke = json.loads(invoke_path.read_text())

    if invoke.get("kind") != "cli":
        return  # Agent-as-target — skip CLI invocation

    input_data = json.loads((test_dir / "input.json").read_text())
    command_template = invoke["command"]
    cwd = invoke.get("cwd")
    timeout_s = invoke.get("timeout_ms", 30000) / 1000

    # Write prompt to temp file for {PROMPT_FILE} placeholder
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as pf:
        pf.write(input_data["input_text"])
        prompt_file = pf.name

    # Create output file path for {OUTPUT_FILE} placeholder
    output_file = tempfile.mktemp(suffix=".txt")

    # Render template
    rendered = command_template
    rendered = rendered.replace("{PROMPT}", input_data["input_text"])
    rendered = rendered.replace("{PROMPT_FILE}", prompt_file)
    rendered = rendered.replace("{OUTPUT_FILE}", output_file)

    start = time.time()
    try:
        result = subprocess.run(
            rendered,
            shell=True,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout_s,
        )
        duration_ms = int((time.time() - start) * 1000)

        if result.returncode != 0:
            response = f"ERROR: target exited with code {result.returncode}\n{result.stderr}"
        elif os.path.exists(output_file):
            response = Path(output_file).read_text()
        else:
            response = result.stdout
    except subprocess.TimeoutExpired:
        duration_ms = int((time.time() - start) * 1000)
        response = f"ERROR: target timed out after {timeout_s}s"
    finally:
        for f in [prompt_file, output_file]:
            try:
                os.unlink(f)
            except OSError:
                pass

    (test_dir / "response.md").write_text(response)
    (test_dir / "timing.json").write_text(
        json.dumps(
            {
                "duration_ms": duration_ms,
                "total_duration_seconds": round(duration_ms / 1000, 3),
            },
            indent=2,
        )
        + "\n"
    )


def main():
    parser = argparse.ArgumentParser(description="Run eval test cases")
    parser.add_argument("eval_path", help="Path to eval YAML file")
    parser.add_argument("--out", required=True, help="Output directory")
    parser.add_argument(
        "--workers", type=int, default=3, help="Parallel workers (default: 3)"
    )
    args = parser.parse_args()

    manifest = run_agentv_input(args.eval_path, args.out)
    out = Path(args.out)

    test_ids = manifest["test_ids"]
    cli_tests = []
    for tid in test_ids:
        test_dir = out / tid
        invoke = json.loads((test_dir / "invoke.json").read_text())
        if invoke.get("kind") == "cli":
            cli_tests.append(test_dir)

    if not cli_tests:
        print(
            f"Extracted {len(test_ids)} test(s). No CLI targets to invoke (agent-as-target mode)."
        )
        return

    print(f"Running {len(cli_tests)} CLI target(s) with {args.workers} workers...")
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(invoke_cli_target, td): td.name for td in cli_tests}
        for future in as_completed(futures):
            tid = futures[future]
            try:
                future.result()
                print(f"  {tid}: done")
            except Exception as e:
                print(f"  {tid}: ERROR — {e}", file=sys.stderr)

    print(f"Done. Responses written to {args.out}")


if __name__ == "__main__":
    main()
