# Proposal: Deprecate TraceEvent, Unify on OutputMessage Format

## Why

The codebase now supports two parallel formats for capturing agent execution traces:
1. `TraceEvent[]` - AgentV's custom format with `type`, `timestamp`, `id`, `name`, `input`, `output`, `text`, `metadata`
2. `OutputMessage[]` with `toolCalls` - OpenAI-style message format

This duplication creates:
- Conversion overhead (extractTraceFromMessages)
- Parallel maintenance of similar data structures
- Confusion about which format to use

Since `OutputMessage`/`ToolCall` already support custom schemas, we can extend them with the optional fields from `TraceEvent` and deprecate the custom format entirely.

## What Changes

1. **Extend `ToolCall` interface** with optional fields:
   - `id?: string` - Stable identifier for pairing
   - `timestamp?: string` - ISO 8601 timestamp

2. **Extend `OutputMessage` interface** with optional fields:
   - `timestamp?: string` - Message-level timestamp
   - `metadata?: Record<string, unknown>` - Provider-specific metadata

3. **Refactor `tool_trajectory` evaluator** to work directly with `outputMessages`
   - Accept `OutputMessage[]` as primary input
   - Remove dependency on `TraceEvent[]` conversion

4. **Deprecate `trace` field** in `ProviderResponse`
   - Add JSDoc deprecation notice
   - Keep working for backward compatibility
   - Document migration path

5. **Remove conversion layer**
   - Delete `extractTraceFromMessages()` function
   - Orchestrator passes `outputMessages` directly to evaluators

6. **Update evaluator context** to include `outputMessages`
   - Add `outputMessages` field to evaluator context
   - Evaluators can work with messages directly

## Impact

- **Affected specs**: `evaluation` capability
- **Affected code**:
  - `packages/core/src/evaluation/providers/types.ts` (extend interfaces)
  - `packages/core/src/evaluation/trace.ts` (deprecate TraceEvent usage)
  - `packages/core/src/evaluation/orchestrator.ts` (pass outputMessages to evaluators)
  - `packages/core/src/evaluation/evaluators.ts` (update tool_trajectory)
  - `packages/core/src/evaluation/types.ts` (add outputMessages to evaluator context)
- **Breaking changes**: None - existing `trace` field continues to work

## Migration Path

### For existing providers using `trace`:
1. Continue working unchanged (deprecated but supported)
2. Optionally migrate to `output_messages` format in JSONL output

### For new providers:
1. Use `output_messages` with `tool_calls` in JSONL output
2. Add optional `timestamp` and `id` fields to tool calls if needed
3. No need to generate separate `trace` field

### For custom evaluators using trace:
1. Update to use `context.outputMessages` instead of `context.trace`
2. Access tool calls via `outputMessages[].toolCalls[]`
3. Trace files can still be parsed by custom code evaluators

## Non-Goals

- Remove `trace` field entirely (backward compatibility required for 1+ release cycles)
- Change wire format conventions (snake_case in JSONL, camelCase in TypeScript)
- Modify `TraceSummary` computation (can be derived from outputMessages)
