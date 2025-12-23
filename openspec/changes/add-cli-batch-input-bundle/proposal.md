# Change: Add batch input bundle contract for CLI provider

## Why
To integrate external batch runners (e.g., GoldenCsvChecker) without duplicating datasets, AgentV needs a way to provide *all* evalcase inputs to a CLI command in one invocation when `provider_batching: true`.

Today, the CLI provider can only pass per-evalcase placeholders (`{PROMPT}`, `{EVAL_ID}`, etc.) and generates `{OUTPUT_FILE}` per invocation. In batching mode we need an explicit contract that provides the full set of evalcases (including ids and messages) to the CLI command.

## What Changes
- Define a batch input bundle file format produced by AgentV during `cli` batch execution.
- Provide the bundle path to the configured command template so the external runner can execute all evalcases and emit a JSONL output keyed by `id`.

## Impact
- Affected specs: `cli-provider`
- Affected code (expected):
  - `packages/core/src/evaluation/providers/cli.ts`
  - `packages/core/src/evaluation/providers/targets.ts` (placeholder rules, if required)
  - tests under `packages/core/test/evaluation/providers/`

**BREAKING**: None intended.