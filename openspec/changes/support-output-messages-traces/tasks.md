# Tasks: Support Output Messages Traces

## Implementation Order

### 1. Define output message types
- [ ] Add `OutputMessage` interface to `types.ts`
- [ ] Add `ToolCall` interface to `types.ts`  
- [ ] Add `output_messages` field to `ProviderResponse`
- [ ] Validate types compile without errors

### 2. Implement trace extraction from output messages
- [ ] Create `extractTraceFromMessages()` function in orchestrator
- [ ] Map `output_messages[].tool_calls[]` to `TraceEvent[]` format
- [ ] Handle missing/optional fields gracefully
- [ ] Generate timestamps for trace events
- [ ] Add unit tests for extraction logic with various message formats

### 3. Update orchestrator trace resolution
- [ ] Modify trace extraction to check `output_messages` after `trace`/`traceRef`
- [ ] Update `computeTraceSummary()` to work with extracted traces
- [ ] Ensure `candidateTrace` and `candidateTraceSummary` populate correctly
- [ ] Add integration test with mock provider using `output_messages`

### 4. Update CLI provider JSONL parsing
- [ ] Add `parseOutputMessages()` method to CLI provider
- [ ] Update `parseJsonlBatchOutput()` to extract `output_messages` field
- [ ] Pass `output_messages` through to `ProviderResponse`
- [ ] Update single-case parsing (`parseOutputContent()`) to support `output_messages`
- [ ] Add tests for JSONL with `output_messages` format

### 5. Validation and testing
- [ ] Run existing test suite to ensure backward compatibility
- [ ] Test tool_trajectory evaluator with `output_messages`-derived traces
- [ ] Test all three modes: any_order, in_order, exact
- [ ] Verify GoldenCsvChecker JSONL works with new extraction
- [ ] Document new `output_messages` format in provider docs

### 6. Documentation
- [ ] Update CLI provider spec with `output_messages` support
- [ ] Add examples showing `output_messages` format
- [ ] Document that `trace` field is now optional
- [ ] Add migration notes for providers currently using `trace`

## Dependencies

- Step 2 depends on Step 1 (type definitions)
- Step 3 depends on Step 2 (extraction function)
- Step 4 is independent (can parallelize with Step 3)
- Step 5 depends on Steps 3 and 4
- Step 6 is final (documents completed work)

## Validation Checkpoints

After Step 3:
- [ ] Orchestrator extracts traces from `output_messages` correctly
- [ ] Trace summary includes correct tool call counts

After Step 4:
- [ ] CLI provider parses JSONL with `output_messages`
- [ ] Both batch and single-case modes work

After Step 5:
- [ ] All existing tests pass
- [ ] Tool trajectory evaluation works with new format
- [ ] GoldenCsvChecker integration verified
