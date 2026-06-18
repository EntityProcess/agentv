"""Helpers for Python code-graders over AgentV's canonical stdin/stdout contract."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Mapping


_FORBIDDEN_WIRE_FIELDS = {
    "output_text",
    "input_text",
    "reference_answer",
    "expected_output_text",
}


def _require_mapping(value: Any, field_name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise TypeError(f"{field_name} must be an object")
    return value


def _require_list(value: Any, field_name: str) -> list[Any]:
    if not isinstance(value, list):
        raise TypeError(f"{field_name} must be a list")
    return value


def _read_output_file(path: str) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


@dataclass(frozen=True)
class Assertion:
    text: str
    passed: bool
    evidence: str | None = None

    def to_wire(self) -> dict[str, Any]:
        wire = {"text": self.text, "passed": self.passed}
        if self.evidence is not None:
            wire["evidence"] = self.evidence
        return wire


@dataclass(frozen=True)
class CodeGraderResult:
    score: float
    assertions: list[Assertion] = field(default_factory=list)
    details: Mapping[str, Any] | None = None

    def to_wire(self) -> dict[str, Any]:
        score = min(max(float(self.score), 0.0), 1.0)
        wire: dict[str, Any] = {
            "score": score,
            "assertions": [assertion.to_wire() for assertion in self.assertions],
        }
        if self.details is not None:
            wire["details"] = dict(self.details)
        return wire


@dataclass
class CodeGraderContext:
    criteria: str
    expected_output: list[Any]
    output: str | None
    messages: list[Any]
    output_path: str | None
    input_files: list[str]
    input: list[Any]
    metadata: Mapping[str, Any] | None
    trace: Mapping[str, Any] | None
    trace_summary: Mapping[str, Any] | None
    token_usage: Mapping[str, Any] | None
    cost_usd: float | None
    duration_ms: float | None
    start_time: str | None
    end_time: str | None
    file_changes: str | None
    workspace_path: str | None
    config: Mapping[str, Any] | None

    @classmethod
    def from_wire(cls, payload: Mapping[str, Any]) -> "CodeGraderContext":
        forbidden = sorted(_FORBIDDEN_WIRE_FIELDS.intersection(payload.keys()))
        if forbidden:
            names = ", ".join(forbidden)
            raise ValueError(f"Deprecated wire fields are not accepted: {names}")

        criteria = payload.get("criteria")
        if not isinstance(criteria, str):
            raise TypeError("criteria must be a string")

        expected_output = _require_list(payload.get("expected_output"), "expected_output")
        input_messages = _require_list(payload.get("input"), "input")
        input_files_raw = _require_list(payload.get("input_files"), "input_files")

        output = payload.get("output")
        if output is not None and not isinstance(output, str):
            raise TypeError("output must be a string or null")

        output_path = payload.get("output_path")
        if output_path is not None and not isinstance(output_path, str):
            raise TypeError("output_path must be a string or null")

        if output is None and output_path:
            loaded = _read_output_file(output_path)
            if loaded is not None and not isinstance(loaded, str):
                raise TypeError("output_path JSON must decode to a string or null")
            output = loaded

        messages_raw = payload.get("messages", [])
        messages = _require_list(messages_raw, "messages")

        def optional_mapping(name: str) -> Mapping[str, Any] | None:
            value = payload.get(name)
            if value is None:
                return None
            return _require_mapping(value, name)

        def optional_number(name: str) -> float | None:
            value = payload.get(name)
            if value is None:
                return None
            if not isinstance(value, (int, float)):
                raise TypeError(f"{name} must be a number or null")
            return float(value)

        def optional_string(name: str) -> str | None:
            value = payload.get(name)
            if value is None:
                return None
            if not isinstance(value, str):
                raise TypeError(f"{name} must be a string or null")
            return value

        return cls(
            criteria=criteria,
            expected_output=expected_output,
            output=output,
            messages=messages,
            output_path=output_path,
            input_files=[str(path) for path in input_files_raw],
            input=input_messages,
            metadata=optional_mapping("metadata"),
            trace=optional_mapping("trace"),
            trace_summary=optional_mapping("trace_summary"),
            token_usage=optional_mapping("token_usage"),
            cost_usd=optional_number("cost_usd"),
            duration_ms=optional_number("duration_ms"),
            start_time=optional_string("start_time"),
            end_time=optional_string("end_time"),
            file_changes=optional_string("file_changes"),
            workspace_path=optional_string("workspace_path"),
            config=optional_mapping("config"),
        )


def load_grader_input(stdin_text: str | None = None) -> CodeGraderContext:
    raw_text = stdin_text if stdin_text is not None else sys.stdin.read()
    payload = json.loads(raw_text)
    return CodeGraderContext.from_wire(_require_mapping(payload, "stdin payload"))


def emit_grader_result(result: CodeGraderResult) -> None:
    sys.stdout.write(f"{json.dumps(result.to_wire(), indent=2)}\n")


class TargetClient:
    """Minimal stdlib client for AgentV's target proxy."""

    def __init__(self, url: str, token: str):
        self._url = url.rstrip("/")
        self._token = token

    @classmethod
    def from_env(cls) -> "TargetClient | None":
        url = os.environ.get("AGENTV_TARGET_PROXY_URL")
        token = os.environ.get("AGENTV_TARGET_PROXY_TOKEN")
        if not url:
            return None
        if not token:
            raise RuntimeError(
                "AGENTV_TARGET_PROXY_URL is set but AGENTV_TARGET_PROXY_TOKEN is missing"
            )
        return cls(url, token)

    def _request(self, method: str, path: str, payload: Mapping[str, Any] | None = None) -> Any:
        body = None
        headers = {"Authorization": f"Bearer {self._token}"}
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"

        request = urllib.request.Request(
            f"{self._url}{path}",
            data=body,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8")
            raise RuntimeError(detail or f"HTTP {error.code}") from error

    def invoke(
        self,
        *,
        question: str,
        system_prompt: str | None = None,
        eval_case_id: str | None = None,
        attempt: int | None = None,
        target: str | None = None,
    ) -> Any:
        return self._request(
            "POST",
            "/invoke",
            {
                "question": question,
                "systemPrompt": system_prompt,
                "evalCaseId": eval_case_id,
                "attempt": attempt,
                "target": target,
            },
        )

    def invoke_batch(self, requests: list[Mapping[str, Any]]) -> Any:
        return self._request("POST", "/invokeBatch", {"requests": requests})

    def get_info(self) -> Any:
        return self._request("GET", "/info")


CodeGraderHandler = Callable[[CodeGraderContext], CodeGraderResult]


def run_code_grader(handler: CodeGraderHandler, stdin_text: str | None = None) -> int:
    try:
        context = load_grader_input(stdin_text=stdin_text)
        emit_grader_result(handler(context))
        return 0
    except Exception as error:
        emit_grader_result(
            CodeGraderResult(
                score=0.0,
                assertions=[Assertion(text=f"Evaluation failed: {error}", passed=False)],
            )
        )
        return 1


def define_code_grader(handler: CodeGraderHandler) -> None:
    raise SystemExit(run_code_grader(handler))
