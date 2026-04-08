#!/usr/bin/env python3
"""
Simple grader that runs INSIDE the Docker container.
Reads JSON from stdin, extracts diff from agent output, applies it, runs tests.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

def extract_diff(output):
    """Extract a unified diff from the agent's output messages."""
    text = ""
    if isinstance(output, list):
        for msg in output:
            if isinstance(msg, dict):
                text += msg.get("content", "") + "\n"
            elif isinstance(msg, str):
                text += msg + "\n"
    elif isinstance(output, str):
        text = output

    # Try to extract from code blocks first
    blocks = re.findall(r"```(?:diff)?\s*\n(.*?)```", text, re.DOTALL)
    if blocks:
        return blocks[0].strip()

    # Try to find unified diff lines
    lines = text.split("\n")
    diff_lines = []
    in_diff = False
    for line in lines:
        if line.startswith("---") or line.startswith("+++") or line.startswith("diff "):
            in_diff = True
        if in_diff:
            diff_lines.append(line)

    if diff_lines:
        return "\n".join(diff_lines).strip()

    return text.strip()


def main():
    payload = json.load(sys.stdin)
    config = payload.get("config", {})
    output = payload.get("output", [])
    fail_to_pass = config.get("fail_to_pass", [])
    
    # Debug info to stderr (won't affect stdout JSON)
    print(f"DEBUG: output type={type(output).__name__}, config keys={list(config.keys())}, fail_to_pass={fail_to_pass}", file=sys.stderr)
    if isinstance(output, list) and output:
        print(f"DEBUG: first output item type={type(output[0]).__name__}, keys={list(output[0].keys()) if isinstance(output[0], dict) else 'N/A'}", file=sys.stderr)

    patch = extract_diff(output)
    assertions = []
    workdir = "/testbed"

    print(f"DEBUG: extracted patch length={len(patch)}", file=sys.stderr)
    print(f"DEBUG: patch first 200 chars: {patch[:200]}", file=sys.stderr)

    if not patch:
        print(json.dumps({
            "score": 0.0,
            "assertions": [{"text": "No patch found in agent output", "passed": False}]
        }))
        return

    # Write patch to temp file and apply
    with tempfile.NamedTemporaryFile(mode="w", suffix=".patch", delete=False) as f:
        f.write(patch + "\n")
        patch_path = f.name

    try:
        result = subprocess.run(
            ["git", "apply", "--allow-empty", patch_path],
            cwd=workdir,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            assertions.append({
                "text": f"git apply failed: {result.stderr.strip()[:200]}",
                "passed": False,
            })
            print(json.dumps({"score": 0.0, "assertions": assertions}))
            return
        assertions.append({"text": "Patch applied successfully", "passed": True})
    except Exception as e:
        assertions.append({"text": f"Patch apply error: {str(e)[:200]}", "passed": False})
        print(json.dumps({"score": 0.0, "assertions": assertions}))
        return
    finally:
        os.unlink(patch_path)

    # Run fail_to_pass tests
    print(f"DEBUG: about to run {len(fail_to_pass)} tests", file=sys.stderr)
    passed = 0
    total = len(fail_to_pass)
    for test in fail_to_pass:
        print(f"DEBUG: running test: {test}", file=sys.stderr)
        try:
            result = subprocess.run(
                ["python", "-m", "pytest", test, "-x", "--tb=short", "-q"],
                cwd=workdir,
                capture_output=True,
                text=True,
                timeout=60,
            )
            print(f"DEBUG: test returncode={result.returncode} stdout={result.stdout[:200]} stderr={result.stderr[:200]}", file=sys.stderr)
            if result.returncode == 0:
                passed += 1
                assertions.append({"text": f"PASS: {test}", "passed": True})
            else:
                assertions.append({
                    "text": f"FAIL: {test} — {result.stdout.strip()[-200:]}",
                    "passed": False,
                })
        except Exception as e:
            print(f"DEBUG: test exception: {e}", file=sys.stderr)
            assertions.append({"text": f"ERROR running {test}: {str(e)[:200]}", "passed": False})

    score = passed / total if total > 0 else 0.0
    print(f"DEBUG: final score={score} passed={passed} total={total}", file=sys.stderr)
    print(json.dumps({"score": score, "assertions": assertions}))


if __name__ == "__main__":
    main()
