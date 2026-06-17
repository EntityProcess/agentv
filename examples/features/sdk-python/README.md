# AgentV Python Helper Example

This example is the smallest repo-local Python helper surface for AgentV.

It is intentionally scoped to two jobs:

- build Python `code-grader` scripts over the existing stdin/stdout contract
- author AgentV-shaped eval definitions and emit canonical YAML/JSONL

It does **not** add a native Python runner. Evaluations still run through the AgentV CLI.

## Layout

- `src/agentv_py/grader.py` - canonical code-grader helper and target proxy client
- `src/agentv_py/evals.py` - YAML/JSONL authoring helpers plus optional CLI invocation
- `scripts/check_expected_output.py` - example Python code-grader
- `scripts/build_eval.py` - example eval definition builder
- `evals/` - generated canonical AgentV YAML/JSONL
- `tests/` - focused pytest coverage for wire fields and emitted shapes

## Constraints

- Canonical wire fields only. Deprecated wire aliases like `output_text`, `input_text`, and `reference_answer` are rejected.
- The helper mirrors AgentV wire names with Python `snake_case` attributes instead of introducing a separate code-first contract.
- Packaging stays example-local until any public Python package boundary is reviewed separately.

## Run

From this directory:

```bash
uv run python scripts/build_eval.py
uv run pytest
uv run python scripts/check_expected_output.py < sample-grader-input.json
```

To run the generated eval through AgentV from the repository root:

```bash
bun apps/cli/src/cli.ts eval examples/features/sdk-python/evals/dataset.eval.yaml --target local_cli
```
