# SDK Example: YAML-Aligned Eval Authoring

Demonstrates authoring a `.eval.ts` suite with `defineEval()` from `@agentv/sdk` while still lowering to AgentV's canonical snake_case YAML/runtime contract.

## What It Shows

1. `defineEval()` brands a TypeScript suite for the `.eval.ts` loader.
2. CamelCase authoring fields such as `inputFiles`, `expectedOutput`, `beforeAll`, and `beforeEach` lower to the canonical YAML/runtime keys.
3. The suite still runs through the standard CLI and YAML parser path instead of a separate SDK runner.

## Files

- `evals/greeting.eval.ts` — the YAML-aligned TypeScript suite
- `.agentv/targets.yaml` — local mock target for a zero-credential run
- `fixtures/*.md` — attached input files used by the suite

## How to Run

```bash
# From repository root
cd examples/features/sdk-eval-authoring
bun install

bun ../../../../apps/cli/src/cli.ts eval evals/greeting.eval.ts
```

The example uses a local `mock` target, so it does not require API credentials.
