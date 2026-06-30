"""Helpers for AgentV-shaped YAML and JSONL eval authoring in Python."""

from __future__ import annotations

import json
import subprocess
from dataclasses import asdict, dataclass, field, is_dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

import yaml


def _wire_value(value: Any) -> Any:
    if hasattr(value, "to_wire"):
        return value.to_wire()
    if is_dataclass(value):
        return {key: _wire_value(item) for key, item in asdict(value).items() if item is not None}
    if isinstance(value, Mapping):
        return {str(key): _wire_value(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [_wire_value(item) for item in value]
    return value


@dataclass(frozen=True)
class EvalTest:
    id: str
    input: Any | None = None
    expected_output: Any | None = None
    criteria: str | None = None
    assertions: list[Any] | None = None
    experiment: Mapping[str, Any] | None = None
    metadata: Mapping[str, Any] | None = None
    extra: Mapping[str, Any] = field(default_factory=dict)

    def to_wire(self) -> dict[str, Any]:
        wire: dict[str, Any] = {"id": self.id}
        if self.criteria is not None:
            wire["criteria"] = self.criteria
        if self.input is not None:
            wire["input"] = _wire_value(self.input)
        if self.expected_output is not None:
            wire["expected_output"] = _wire_value(self.expected_output)
        if self.assertions is not None:
            wire["assertions"] = _wire_value(self.assertions)
        if self.experiment is not None:
            wire["experiment"] = _wire_value(self.experiment)
        if self.metadata is not None:
            wire["metadata"] = _wire_value(self.metadata)
        wire.update(_wire_value(self.extra))
        return wire


@dataclass(frozen=True)
class JsonlCase:
    id: str
    input: Any
    expected_output: Any | None = None
    criteria: str | None = None
    experiment: Mapping[str, Any] | None = None
    metadata: Mapping[str, Any] | None = None
    extra: Mapping[str, Any] = field(default_factory=dict)

    def to_wire(self) -> dict[str, Any]:
        wire = {"id": self.id, "input": _wire_value(self.input)}
        if self.criteria is not None:
            wire["criteria"] = self.criteria
        if self.expected_output is not None:
            wire["expected_output"] = _wire_value(self.expected_output)
        if self.experiment is not None:
            wire["experiment"] = _wire_value(self.experiment)
        if self.metadata is not None:
            wire["metadata"] = _wire_value(self.metadata)
        wire.update(_wire_value(self.extra))
        return wire


@dataclass(frozen=True)
class EvalDefinition:
    description: str | None = None
    name: str | None = None
    experiment: Mapping[str, Any] | None = None
    tags: list[str] | None = None
    tests: list[EvalTest] | str | None = None
    extra: Mapping[str, Any] = field(default_factory=dict)

    def to_wire(self) -> dict[str, Any]:
        wire: dict[str, Any] = {}
        if self.description is not None:
            wire["description"] = self.description
        if self.name is not None:
            wire["name"] = self.name
        if self.experiment is not None:
            wire["experiment"] = _wire_value(self.experiment)
        if self.tags is not None:
            wire["tags"] = list(self.tags)
        if self.tests is not None:
            if isinstance(self.tests, str):
                wire["tests"] = self.tests
            else:
                wire["tests"] = [_wire_value(test) for test in self.tests]
        wire.update(_wire_value(self.extra))
        return wire


def render_eval_yaml(eval_definition: EvalDefinition | Mapping[str, Any]) -> str:
    wire = _wire_value(eval_definition)
    return yaml.safe_dump(wire, sort_keys=False, allow_unicode=False)


def write_eval_yaml(path: str | Path, eval_definition: EvalDefinition | Mapping[str, Any]) -> Path:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(render_eval_yaml(eval_definition), encoding="utf-8")
    return destination


def render_jsonl(rows: Sequence[JsonlCase | Mapping[str, Any]]) -> str:
    return "".join(f"{json.dumps(_wire_value(row), sort_keys=False)}\n" for row in rows)


def write_jsonl(path: str | Path, rows: Sequence[JsonlCase | Mapping[str, Any]]) -> Path:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(render_jsonl(rows), encoding="utf-8")
    return destination


def _find_repo_root(start: Path) -> Path | None:
    for candidate in [start, *start.parents]:
        if (candidate / "apps" / "cli" / "src" / "cli.ts").exists():
            return candidate
    return None


def default_agentv_command(start: str | Path | None = None) -> list[str]:
    start_path = Path(start).resolve() if start is not None else Path.cwd()
    repo_root = _find_repo_root(start_path)
    if repo_root is not None:
        return ["bun", str(repo_root / "apps" / "cli" / "src" / "cli.ts")]
    return ["agentv"]


def run_agentv_eval(
    eval_path: str | Path,
    *,
    cli_command: Sequence[str] | None = None,
    extra_args: Sequence[str] | None = None,
    cwd: str | Path | None = None,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    command = list(cli_command or default_agentv_command(cwd or Path(eval_path).resolve().parent))
    command.extend(["eval", str(eval_path)])
    if extra_args:
        command.extend(extra_args)
    return subprocess.run(
        command,
        cwd=str(cwd) if cwd is not None else None,
        check=check,
        text=True,
        capture_output=True,
    )
