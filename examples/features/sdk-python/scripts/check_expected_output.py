#!/usr/bin/env python3

from __future__ import annotations

from agentv_py.grader import Check, ScriptGraderContext, ScriptGraderResult, define_script_grader


def evaluate(context: ScriptGraderContext) -> ScriptGraderResult:
    expected = context.expected_output[0]["content"] if context.expected_output else ""
    actual = context.output or ""
    passed = actual.strip() == expected.strip()
    return ScriptGraderResult(
        pass_=passed,
        score=1.0 if passed else 0.0,
        reason="Candidate output matches expected output"
        if passed
        else "Candidate output does not match expected output",
        checks=[
            Check(
                text="Candidate output matches expected output",
                pass_=passed,
                reason="Exact string comparison passed" if passed else "Exact string comparison failed",
            )
        ],
    )


if __name__ == "__main__":
    define_script_grader(evaluate)
