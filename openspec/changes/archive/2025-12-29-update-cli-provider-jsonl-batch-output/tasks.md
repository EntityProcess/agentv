## 1. Implementation
- [x] 1.1 Update `CliProvider` to declare `supportsBatch = true`.
- [x] 1.2 Implement `invokeBatch(requests)` for `CliProvider`:
  - [x] Run the configured CLI command once.
  - [x] Read `{OUTPUT_FILE}` after successful exit.
  - [x] Parse the output as JSONL (one JSON object per line).
  - [x] Build a map keyed by `id` and return responses aligned to the input `requests` order.
  - [x] Fail with a clear error if any requested `evalCaseId` is missing from the output.
  - [x] Validate `trace` entries using `isTraceEvent` and drop invalid events.
  - [x] Clean up the temp output file.
- [x] 1.3 Preserve existing `invoke()` behavior for non-batched evaluations (single JSON or plain text).
- [x] 1.4 Add/update tests for `cli` provider batching + JSONL parsing.

## 2. Validation
- [x] 2.1 Run unit tests for `packages/core`.
- [x] 2.2 Ensure TypeScript build passes.
