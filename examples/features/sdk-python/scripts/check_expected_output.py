#!/usr/bin/env python3

from __future__ import annotations

from agentv_py.grader import Assertion, CodeGraderContext, CodeGraderResult, define_code_grader


def evaluate(context: CodeGraderContext) -> CodeGraderResult:
    expected = context.expected_output[0]["content"] if context.expected_output else ""
    actual = context.output or ""
    passed = actual.strip() == expected.strip()
    return CodeGraderResult(
        score=1.0 if passed else 0.0,
        assertions=[
            Assertion(
                text="Candidate output matches expected output",
                passed=passed,
            )
        ],
    )


if __name__ == "__main__":
    define_code_grader(evaluate)
