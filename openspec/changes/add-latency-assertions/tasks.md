## 1. Type Definitions

- [x] 1.1 Add `durationMs?: number` to `ToolCall` interface in `packages/core/src/evaluation/providers/types.ts`
- [x] 1.2 Add `durationMs?: number` to `OutputMessage` interface in `packages/core/src/evaluation/providers/types.ts`
- [x] 1.3 Add `maxDurationMs?: number` to `ToolTrajectoryExpectedItem` in `packages/core/src/evaluation/trace.ts`

## 2. Wire Format Parsing

- [x] 2.1 Update JSONL parser to extract `duration_ms` from tool calls (snake_case → camelCase)
- [x] 2.2 Update JSONL parser to extract `duration_ms` from output messages
- [x] 2.3 Add tests for parsing timing data from JSONL

## 3. Tool Trajectory Evaluator

- [x] 3.1 Extract latency assertions from expected items in `tool-trajectory.ts`
- [x] 3.2 Implement latency check when matching tool calls (compare against `maxDurationMs`)
- [x] 3.3 Add hits/misses for latency assertions (e.g., "Read completed in 45ms (max: 100ms)")
- [x] 3.4 Handle missing `durationMs` gracefully (log warning, don't fail)
- [x] 3.5 Add unit tests for latency assertion pass/fail cases
- [x] 3.6 Add integration test with sample YAML eval file

## 4. Documentation

- [x] 4.1 Update skill references with `max_duration_ms` example in expected_messages
- [x] 4.2 Add example to `examples/features/` demonstrating latency assertions

## 5. Validation

- [x] 5.1 Run `bun run build && bun run typecheck && bun run lint && bun test`
- [x] 5.2 Validate proposal: `openspec validate add-latency-assertions --strict`
