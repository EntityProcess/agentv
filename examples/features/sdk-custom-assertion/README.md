# SDK Example: Custom Assertion

Demonstrates creating a custom assertion type using `defineAssertion()` from `@agentv/eval` and convention-based discovery from `.agentv/assertions/`.

## What It Does

1. Defines a `word-count` assertion in `.agentv/assertions/word-count.ts`
2. Uses it in EVAL.yaml via `type: word-count` under `assert:`
3. The assertion checks that the output has a minimum word count

## How to Run

```bash
# From repository root
cd examples/features/sdk-custom-assertion
bun install

# Run the evaluation (uses mock_agent)
agentv eval evals/dataset.eval.yaml
```

## Key Patterns

- **`defineAssertion()`** — simplest way to add custom evaluation logic
- **Convention discovery** — files in `.agentv/assertions/` are auto-discovered by type name
- **Pass/fail with reasoning** — return `{ pass, reasoning }` for clear results
