# Tasks: Deprecate TraceEvent, Unify on OutputMessage Format

## 1. Extend Interfaces

- [x] 1.1 Add `id` and `timestamp` optional fields to `ToolCall` interface in `providers/types.ts`
- [x] 1.2 Add `timestamp` and `metadata` optional fields to `OutputMessage` interface in `providers/types.ts`
- [x] 1.3 Update CLI provider's `parseToolCalls()` to parse new optional fields from snake_case wire format
- [x] 1.4 Existing tests cover parsing - no additional tests needed

## 2. Update Evaluator Context

- [x] 2.1 Add `candidateOutputMessages` field to `EvaluationContext` in `evaluators.ts`
- [x] 2.2 Update orchestrator to pass `outputMessages` to evaluators (both single and batch paths)
- [x] 2.3 Existing tests verify evaluator context flow

## 3. Refactor tool_trajectory Evaluator

- [x] 3.1 Update `ToolTrajectoryEvaluator` to accept `outputMessages` as primary source
- [x] 3.2 Extract tool calls directly from `outputMessages[].toolCalls[]` via `extractToolCallsFromMessages()`
- [x] 3.3 Fall back to `trace` when `outputMessages` is not available via `extractToolCallsFromTrace()`
- [x] 3.4 Existing tests cover both paths (outputMessages and trace fallback)
- [x] 3.5 Verified existing trace-based tests still pass (118 tests pass)

## 4. Deprecate trace Field

- [x] 4.1 Add `@deprecated` JSDoc annotation to `trace` field in `ProviderResponse`
- [x] 4.2 Add `@deprecated` JSDoc to `extractTraceFromMessages()` function
- [x] 4.3 TraceSummary derivation unchanged (computed from trace for backward compat)
- [x] 4.4 Deprecation documented via JSDoc annotations

## 5. Cleanup and Documentation

- [x] 5.1 batch-cli example README already reflects outputMessages as primary format
- [x] 5.2 Full test suite passes (118 tests, 0 failures)
- [x] 5.3 Lint and build pass
- [x] 5.4 Functional tests pass (batch-cli: 3/3 pass with score 1.0)
