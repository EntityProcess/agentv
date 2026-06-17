#!/usr/bin/env python3

from __future__ import annotations

from pathlib import Path

from agentv_py.evals import EvalDefinition, JsonlCase, write_eval_yaml, write_jsonl


ROOT = Path(__file__).resolve().parents[1]
EVALS_DIR = ROOT / "evals"


def main() -> None:
    write_jsonl(
        EVALS_DIR / "dataset.jsonl",
        [
            JsonlCase(
                id="python-helper-local-cli",
                input=[{"role": "user", "content": "AgentV Python helper says hi."}],
                expected_output=[
                    {"role": "assistant", "content": "AgentV Python helper says hi."}
                ],
                extra={
                    "assertions": [
                        {
                            "name": "python-expected-output",
                            "type": "code-grader",
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
        EVALS_DIR / "dataset.eval.yaml",
        EvalDefinition(
            description="Python helper example that emits canonical AgentV YAML/JSONL.",
            name="python-helper",
            execution={"target": "local_cli"},
            tags=["python", "sdk"],
            tests="./dataset.jsonl",
        ),
    )


if __name__ == "__main__":
    main()
