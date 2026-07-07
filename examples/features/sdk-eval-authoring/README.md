# SDK Example: TypeScript Eval Config Authoring

Demonstrates authoring an explicit `*.eval.ts` file with the `EvalConfig` type from `@agentv/sdk`.

## What It Shows

1. `evals/greeting.eval.ts` uses a default export as the supported TypeScript eval config contract.
2. The `graders` helper catalog returns ordinary `assert` entries.
3. CamelCase authoring fields such as per-test `inputFiles` lower to the canonical YAML/runtime keys.
4. The suite still runs through the standard CLI and YAML parser path instead of a separate SDK runner.

## Files

- `evals/greeting.eval.ts` — the TypeScript eval config
- `.agentv/providers.yaml` — local mock target for a zero-credential run
- `fixtures/per-test-note.md` — attached input file used by the suite

## How to Run

```bash
# From repository root
cd examples/features/sdk-eval-authoring
bun install

bun ../../../../apps/cli/src/cli.ts eval evals/greeting.eval.ts
```

The example uses a local `mock` target, so it does not require API credentials.
