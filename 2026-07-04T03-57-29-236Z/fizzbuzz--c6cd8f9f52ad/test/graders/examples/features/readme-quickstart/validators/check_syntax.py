#!/usr/bin/env python3
import ast
import json
import re
import sys


def result(score, text, passed, evidence):
    print(
        json.dumps(
            {
                "score": score,
                "assertions": [{"text": text, "passed": passed, "evidence": evidence}],
            }
        )
    )


payload = json.load(sys.stdin)
output = payload.get("output") or ""

match = re.search(r"```(?:python|py)?\s*(.*?)```", output, re.IGNORECASE | re.DOTALL)
code = match.group(1).strip() if match else output.strip()

try:
    tree = ast.parse(code)
except SyntaxError as exc:
    result(0, "Generated Python parses successfully", False, f"SyntaxError: {exc}")
    sys.exit(0)

source = code.lower()
has_loop = any(isinstance(node, (ast.For, ast.While)) for node in ast.walk(tree))
has_print = "print(" in source
has_branches = all(token in source for token in ["3", "5"]) and "fizzbuzz" in source

passed = has_loop and has_print and has_branches
evidence = "Found loop, print call, and 3/5 fizzbuzz branch markers." if passed else (
    f"loop={has_loop}, print={has_print}, branch_markers={has_branches}"
)
result(1 if passed else 0, "Generated code is executable FizzBuzz-style Python", passed, evidence)
