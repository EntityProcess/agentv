#!/usr/bin/env python3

from __future__ import annotations

from pathlib import Path

from agentv_py.evals import EvalDefinition, JsonlCase, write_eval_yaml, write_jsonl


ROOT = Path(__file__).resolve().parents[1]
EVALS_DIR = ROOT / "evals"


def main() -> None:
    write_jsonl(
        EVALS_DIR / "cases.jsonl",
        [
            JsonlCase(
                id="python-helper-local-cli",
                input=[{"role": "user", "content": "AgentV Python helper says hi."}],
                expected_output=[
                    {"role": "assistant", "content": "AgentV Python helper says hi."}
                ],
                extra={
                    "assert": [
                        {
                            "metric": "python-expected-output",
                            "type": "script",
                            "command": [
                                "uv",
                                "run",
                                "python",
                                "../scripts/check_expected_output.py",
                            ],
                        }
                    ]
                },
            )
        ],
    )

    write_eval_yaml(
        EVALS_DIR / "suite.yaml",
        EvalDefinition(
            description="Python helper example that emits canonical AgentV YAML/JSONL.",
            name="python-helper",
            target="local_cli",
            tags=["python", "sdk"],
            tests="./cases.jsonl",
        ),
    )


if __name__ == "__main__":
    main()
