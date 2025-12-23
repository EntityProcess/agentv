# Change: Support JSONL batch output for CLI provider

## Why
AgentV’s `cli` provider currently expects a single JSON response `{ text, trace? }` per eval case invocation and does not support consuming batched results.

We need to evaluate external/batch runners (e.g., GoldenCsvChecker) that execute once and write a single JSONL file containing multiple eval case results. This improves performance (one external process per panel instead of per case), and aligns with standard eval harness patterns (JSONL records keyed by stable ids).

## What Changes
- Add support for the `cli` provider to consume **JSONL batch output** when provider batching is enabled.
- Add an `invokeBatch` implementation for the `cli` provider so AgentV can run the command once for multiple eval cases.
- Define a **JSONL record schema** that includes a stable `id` used to map each record to `evalCase.id`.
- Maintain backwards compatibility: existing per-case `invoke()` behavior and single-JSON output remains supported.

## Out of scope (future changesets)
- Defining a batch *input* contract for the CLI provider (e.g. AgentV generating a request bundle file containing all evalcase prompts/messages and passing it to the CLI command).

This change is intentionally limited to letting AgentV ingest batched **results/traces** emitted by an external runner that already knows how to execute the evalcases.

## Impact
- Affected specs: **(new)** `cli-provider` capability
- Affected code:
  - `packages/core/src/evaluation/providers/cli.ts`
  - `packages/core/src/evaluation/providers/types.ts` (documentation/types only, if needed)
  - Tests under `packages/core/test/evaluation/providers/`

**BREAKING**: None intended.
