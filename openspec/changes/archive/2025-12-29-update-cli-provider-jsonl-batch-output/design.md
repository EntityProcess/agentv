## Context
AgentV currently supports provider batching at the orchestrator level via an optional `invokeBatch` hook when `supportsBatch=true`. The `cli` provider does not yet implement this, forcing one process invocation per eval case.

External tools (e.g., GoldenCsvChecker) naturally produce batched artifacts (JSONL) for many eval cases in a single run. This change adds a first-class path for that model.

## Goals
- Allow `cli` targets to execute once and emit a single JSONL file containing results for multiple eval cases.
- Provide deterministic mapping from JSONL records to `evalCase.id`.
- Keep existing single-case invocation behavior unchanged.

## Non-Goals
- Streaming partial results while the process is still running.
- Supporting multiple output formats beyond JSONL and existing single JSON / plain text.
- Changing evaluator semantics.
- Changing AgentV eval YAML requirements (e.g. making `input_messages` optional) or how prompts are built.
- Defining a batch input/request-bundle interface for the CLI provider.

## Future work (next changesets)
- Add an explicit batch input contract for `cli` batching (e.g. AgentV writes a request bundle file for all evalcases and passes its path to the CLI command).

## Decisions
- JSONL records MUST preventing ambiguity by including an `id` field matching `evalCase.id`.
- Batch invocation will be enabled through existing `provider_batching: true` target configuration.

## JSONL Record Shape
Each JSON line SHOULD be a JSON object with:
- `id` (string, required): must equal `evalCase.id`
- `text` (string | unknown, required): final answer text; coerced to string if non-string
- `trace` (array, optional): array of TraceEvents; invalid events are ignored
- additional fields are allowed and ignored

## Failure Modes
- Non-zero exit code: surface stderr/stdout context as currently done.
- Missing records: error listing missing `evalCaseId` values.
- Unparseable JSONL lines: error indicating line number and excerpt.

## Security / Safety
- Output parsing only; no execution beyond configured CLI.
- Avoid logging the full output by default; errors should include truncated excerpts.
