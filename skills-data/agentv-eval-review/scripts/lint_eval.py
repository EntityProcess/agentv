#!/usr/bin/env python3
"""Lint AgentV eval YAML files for common issues.

Usage: python lint_eval.py <path-to-eval-dir-or-file> [--json]

Checks:
  - File uses .eval.yaml extension
  - description field present
  - Each test has id, input, criteria
  - File paths in type:file use leading /
  - assertions blocks present (not relying solely on expected_output)
  - expected_output does not contain evaluation criteria prose
  - Repeated file inputs across tests (should use top-level input)
  - Naming prefix consistency across eval files in same directory

Exit code: 0 if no issues, 1 if issues found.
"""

import json
import os
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    # Fall back to basic YAML parsing if PyYAML not available
    yaml = None


def parse_yaml_basic(text: str) -> dict:
    """Minimal YAML-ish parser for when PyYAML is unavailable."""
    # This is a best-effort fallback; recommend installing PyYAML
    import ast
    # Try json first (YAML is a superset of JSON)
    try:
        return json.loads(text)
    except Exception:
        pass
    return {}


def load_yaml(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    if yaml:
        return yaml.safe_load(text) or {}
    return parse_yaml_basic(text)


def lint_file(path: Path) -> list[dict]:
    issues = []

    def issue(severity: str, msg: str, line: int | None = None):
        issues.append({"file": str(path), "severity": severity, "message": msg, "line": line})

    # Check extension
    if not path.name.endswith(".eval.yaml"):
        issue("error", f"File should use .eval.yaml extension, got: {path.name}")

    try:
        data = load_yaml(path)
    except Exception as e:
        issue("error", f"Failed to parse YAML: {e}")
        return issues

    if not isinstance(data, dict):
        issue("error", "Root element is not a mapping")
        return issues

    # Check description
    if "description" not in data:
        issue("warning", "Missing top-level 'description' field")

    tests = data.get("tests", [])
    if not isinstance(tests, list):
        issue("error", "'tests' is not a list")
        return issues

    if not tests:
        issue("warning", "No tests defined")
        return issues

    # Check for top-level input (shared file references)
    top_level_input = data.get("input")

    # Collect file values across tests to detect repetition
    file_values_per_test: list[list[str]] = []

    for i, test in enumerate(tests):
        test_id = test.get("id", f"test-{i}")

        if "id" not in test:
            issue("error", f"Test at index {i} missing 'id'")

        if "input" not in test and top_level_input is None:
            issue("error", f"Test '{test_id}' missing 'input' and no top-level input defined")

        has_criteria = "criteria" in test
        has_expected = "expected_output" in test
        has_assertions = "assertions" in test

        if not has_criteria and not has_expected and not has_assertions:
            issue("error", f"Test '{test_id}' needs at least one of: criteria, expected_output, assertions")

        # Check assertions present
        if not has_assertions and has_expected:
            issue("warning", f"Test '{test_id}' has expected_output but no assertions — add deterministic assertions where possible")

        # Check expected_output for prose patterns
        if has_expected:
            expected = test["expected_output"]
            expected_text = ""
            if isinstance(expected, str):
                expected_text = expected
            elif isinstance(expected, list):
                for msg in expected:
                    if isinstance(msg, dict):
                        content = msg.get("content", "")
                        if isinstance(content, str):
                            expected_text += content

            prose_patterns = [
                r"[Tt]he agent should",
                r"[Ss]hould identify",
                r"[Ss]hould flag",
                r"[Ss]hould recommend",
                r"[Ss]hould produce",
                r"[Ss]hould detect",
                r"[Ss]hould load",
                r"[Ss]hould run",
            ]
            for pat in prose_patterns:
                if re.search(pat, expected_text):
                    issue("warning", f"Test '{test_id}' expected_output contains evaluation criteria prose ('{pat.lstrip('[Tt]').lstrip('[Ss]')}...') — use criteria or assertions instead")
                    break

        # Collect file values from input
        test_files = extract_file_values(test.get("input", []))
        file_values_per_test.append(test_files)

        # Check file paths for leading /
        for fv in test_files:
            if not fv.startswith("/"):
                issue("warning", f"Test '{test_id}' file path missing leading '/': {fv}")

    # Check for repeated file inputs
    if len(file_values_per_test) >= 2 and not top_level_input:
        common_files = set(file_values_per_test[0])
        for fvs in file_values_per_test[1:]:
            common_files &= set(fvs)
        if common_files:
            issue("info", f"File input repeated in every test: {', '.join(sorted(common_files))} — consider using top-level input")

    return issues


def extract_file_values(input_data) -> list[str]:
    """Extract type:file values from input structure."""
    files = []
    if isinstance(input_data, list):
        for item in input_data:
            if isinstance(item, dict):
                content = item.get("content", [])
                if isinstance(content, list):
                    for c in content:
                        if isinstance(c, dict) and c.get("type") == "file":
                            v = c.get("value", "")
                            if v:
                                files.append(v)
    return files


def lint_directory(path: Path) -> list[dict]:
    issues = []
    eval_files = sorted(path.rglob("*.yaml")) + sorted(path.rglob("*.yml"))

    if not eval_files:
        issues.append({"file": str(path), "severity": "warning", "message": "No eval files found", "line": None})
        return issues

    # Check naming prefix consistency
    prefixes = set()
    for f in eval_files:
        name = f.stem.replace(".eval", "")
        parts = name.split("-")
        if len(parts) >= 2:
            prefixes.add(parts[0])

    if len(prefixes) > 1:
        issues.append({
            "file": str(path),
            "severity": "info",
            "message": f"Inconsistent naming prefixes: {', '.join(sorted(prefixes))}",
            "line": None,
        })

    for f in eval_files:
        issues.extend(lint_file(f))

    return issues


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <path> [--json]", file=sys.stderr)
        sys.exit(2)

    target = Path(sys.argv[1])
    output_json = "--json" in sys.argv

    if target.is_file():
        issues = lint_file(target)
    elif target.is_dir():
        issues = lint_directory(target)
    else:
        print(f"Error: {target} not found", file=sys.stderr)
        sys.exit(2)

    if output_json:
        print(json.dumps(issues, indent=2))
    else:
        for iss in issues:
            line = f":{iss['line']}" if iss.get("line") else ""
            print(f"[{iss['severity'].upper()}] {iss['file']}{line}: {iss['message']}")

        counts = {}
        for iss in issues:
            counts[iss["severity"]] = counts.get(iss["severity"], 0) + 1
        if issues:
            print(f"\n{len(issues)} issues: {', '.join(f'{v} {k}' for k, v in sorted(counts.items()))}")
        else:
            print("No issues found.")

    sys.exit(1 if any(i["severity"] == "error" for i in issues) else 0)


if __name__ == "__main__":
    main()
