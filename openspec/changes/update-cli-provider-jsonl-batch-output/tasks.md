## 1. Implementation
- [ ] 1.1 Update `CliProvider` to declare `supportsBatch = true`.
- [ ] 1.2 Implement `invokeBatch(requests)` for `CliProvider`:
  - [ ] Run the configured CLI command once.
  - [ ] Read `{OUTPUT_FILE}` after successful exit.
  - [ ] Parse the output as JSONL (one JSON object per line).
  - [ ] Build a map keyed by `id` and return responses aligned to the input `requests` order.
  - [ ] Fail with a clear error if any requested `evalCaseId` is missing from the output.
  - [ ] Validate `trace` entries using `isTraceEvent` and drop invalid events.
  - [ ] Clean up the temp output file.
- [ ] 1.3 Preserve existing `invoke()` behavior for non-batched evaluations (single JSON or plain text).
- [ ] 1.4 Add/update tests for `cli` provider batching + JSONL parsing.

## 2. Validation
- [ ] 2.1 Run unit tests for `packages/core`.
- [ ] 2.2 Ensure TypeScript build passes.
