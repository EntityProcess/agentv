# Python Helper Example Note

## Decision

Keep the initial Python helper surface repo-local under `examples/features/sdk-python/` instead of creating a new top-level package boundary.

## Why this is the smallest correct step

- The user direction is to align with existing AgentV YAML and wire schemas first.
- The helper example does not need a Python-native runner because the AgentV CLI already executes evals.
- A top-level published package would force packaging, versioning, release, and support decisions that are larger than the current bead scope.

## Included surface

- A Python `code-grader` helper that reads canonical AgentV stdin JSON and writes canonical stdout JSON.
- Rejection of deprecated wire aliases like `output_text`, `input_text`, and `reference_answer`.
- A small target proxy client for grader-side LLM calls when `target` is configured.
- A YAML-shaped eval definition helper that emits existing AgentV YAML and JSONL and can shell out to `agentv eval`.

## Explicit non-goals

- No `.eval.py` discovery.
- No Python runner parallel to the TypeScript CLI.
- No changes to TypeScript package boundaries.

## Next packaging decision

If this helper proves useful after design review, the follow-up should decide:

1. whether the Python helper becomes a published package
2. whether schemas stay stdlib/dataclass-based or move to a validation library
3. how CLI invocation should be packaged outside the monorepo checkout
