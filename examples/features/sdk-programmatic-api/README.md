# SDK Example: Programmatic API

Demonstrates using `evaluate()` from `@agentv/core` to run evaluations as a library — no YAML needed.

## What It Does

1. Imports `evaluate()` from `@agentv/core`
2. Defines tests inline with assertions
3. Runs the evaluation and prints summary statistics

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
- **Inline tests** — define tests in TypeScript, no YAML needed
- **Config mirrors YAML** — same `assert`, `target` structure
- **Typed results** — `EvalRunResult` with summary statistics
