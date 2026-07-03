#!/usr/bin/env python3

from __future__ import annotations

from agentv_py.grader import Assertion, ScriptGraderContext, ScriptGraderResult, define_script_grader


def evaluate(context: ScriptGraderContext) -> ScriptGraderResult:
    expected = context.expected_output[0]["content"] if context.expected_output else ""
    actual = context.output or ""
    passed = actual.strip() == expected.strip()
    return ScriptGraderResult(
        score=1.0 if passed else 0.0,
        assertions=[
            Assertion(
                text="Candidate output matches expected output",
                passed=passed,
            )
        ],
    )


if __name__ == "__main__":
    define_script_grader(evaluate)
