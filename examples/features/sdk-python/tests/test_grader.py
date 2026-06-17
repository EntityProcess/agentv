from __future__ import annotations

import json
from pathlib import Path

import pytest

from agentv_py.grader import Assertion, CodeGraderContext, CodeGraderResult, load_grader_input, run_code_grader


def canonical_payload() -> dict:
    return {
        "criteria": "Match expected output",
        "expected_output": [{"role": "assistant", "content": "AgentV Python helper says hi."}],
        "output": "AgentV Python helper says hi.",
        "messages": [{"role": "assistant", "content": "AgentV Python helper says hi."}],
        "input_files": [],
        "input": [{"role": "user", "content": "Reply with exactly: AgentV Python helper says hi."}],
        "metadata": {"suite": "python-helper"},
        "trace": None,
        "trace_summary": None,
        "token_usage": None,
        "cost_usd": None,
        "duration_ms": None,
        "start_time": None,
        "end_time": None,
        "file_changes": None,
        "workspace_path": None,
        "config": {"strict": True},
    }


def test_load_grader_input_accepts_canonical_fields() -> None:
    context = load_grader_input(json.dumps(canonical_payload()))

    assert context.criteria == "Match expected output"
    assert context.output == "AgentV Python helper says hi."
    assert context.expected_output[0]["content"] == "AgentV Python helper says hi."
    assert context.config == {"strict": True}


def test_load_grader_input_rejects_deprecated_wire_aliases() -> None:
    payload = canonical_payload()
    payload["output_text"] = payload["output"]

    with pytest.raises(ValueError, match="Deprecated wire fields"):
        CodeGraderContext.from_wire(payload)


def test_load_grader_input_reads_output_path(tmp_path: Path) -> None:
    output_path = tmp_path / "output.json"
    output_path.write_text(json.dumps("loaded from file"), encoding="utf-8")

    payload = canonical_payload()
    payload["output"] = None
    payload["output_path"] = str(output_path)

    context = load_grader_input(json.dumps(payload))
    assert context.output == "loaded from file"


def test_run_code_grader_emits_canonical_result(capsys: pytest.CaptureFixture[str]) -> None:
    def handler(_: CodeGraderContext) -> CodeGraderResult:
        return CodeGraderResult(
            score=1.0,
            assertions=[Assertion(text="Exact match", passed=True)],
            details={"source": "pytest"},
        )

    exit_code = run_code_grader(handler, stdin_text=json.dumps(canonical_payload()))

    assert exit_code == 0
    emitted = json.loads(capsys.readouterr().out)
    assert emitted == {
        "score": 1.0,
        "assertions": [{"text": "Exact match", "passed": True}],
        "details": {"source": "pytest"},
    }
