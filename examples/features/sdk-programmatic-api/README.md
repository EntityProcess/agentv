# SDK Example: Programmatic API

Demonstrates using `evaluate()` from `@agentv/sdk` to run evaluations as a library when the eval definition belongs in TypeScript. The config mirrors the canonical YAML surface, but uses programmatic names such as `expectedOutput` and `assert`.

## What It Does

1. Imports `evaluate()` from `@agentv/sdk`
2. Defines tests inline with `assert`
3. Runs the evaluation and prints summary statistics
4. Writes canonical AgentV run artifacts under `.agentv/results/...`

## How to Run

```bash
# From repository root
cd examples/features/sdk-programmatic-api
bun install

# Run the programmatic evaluation
bun run evaluate.ts
```

## Key Patterns

- **`evaluate()`** — use AgentV as a library, not just a CLI
- **Inline tests** — define YAML-shaped tests directly in TypeScript
- **Config mirrors YAML** — same evaluation model, with programmatic `assert` and camelCase fields
- **Typed results** — `EvalRunResult` with summary statistics
- **Canonical artifacts** — opt into the same `index.jsonl` / `benchmark.json` workspace layout as `agentv eval`
