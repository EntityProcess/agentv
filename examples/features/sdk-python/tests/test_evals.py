from __future__ import annotations

import json
from pathlib import Path

import yaml

from agentv_py.evals import EvalDefinition, JsonlCase, render_eval_yaml, render_jsonl, write_eval_yaml, write_jsonl


def test_render_eval_yaml_emits_canonical_shape() -> None:
    rendered = render_eval_yaml(
        EvalDefinition(
            description="Example",
            name="python-helper",
            target="local_cli",
            tags=["python"],
            tests="./cases.jsonl",
            extra={"defaults": {"assert": [{"type": "script", "command": ["python3", "grader.py"]}]}},
        )
    )

    parsed = yaml.safe_load(rendered)
    assert parsed == {
        "description": "Example",
        "name": "python-helper",
        "target": "local_cli",
        "tags": ["python"],
        "tests": "./cases.jsonl",
        "defaults": {
            "assert": [{"type": "script", "command": ["python3", "grader.py"]}]
        },
    }


def test_render_jsonl_emits_canonical_lines() -> None:
    rendered = render_jsonl(
        [
            JsonlCase(
                id="case-1",
                criteria="Must match",
                input=[{"role": "user", "content": "hi"}],
                expected_output=[{"role": "assistant", "content": "hello"}],
            )
        ]
    )

    line = json.loads(rendered.strip())
    assert line == {
        "id": "case-1",
        "input": [{"role": "user", "content": "hi"}],
        "criteria": "Must match",
        "expected_output": [{"role": "assistant", "content": "hello"}],
    }


def test_write_helpers_persist_expected_files(tmp_path: Path) -> None:
    eval_path = write_eval_yaml(
        tmp_path / "suite.yaml",
        EvalDefinition(name="python-helper", tests="./cases.jsonl"),
    )
    jsonl_path = write_jsonl(
        tmp_path / "cases.jsonl",
        [JsonlCase(id="case-1", input="hello")],
    )

    assert yaml.safe_load(eval_path.read_text(encoding="utf-8")) == {
        "name": "python-helper",
        "tests": "./cases.jsonl",
    }
    assert json.loads(jsonl_path.read_text(encoding="utf-8").strip()) == {
        "id": "case-1",
        "input": "hello",
    }
