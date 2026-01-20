## 1. Type Definitions

- [ ] 1.1 Add `durationMs?: number` to `ToolCall` interface in `packages/core/src/evaluation/providers/types.ts`
- [ ] 1.2 Add `durationMs?: number` to `OutputMessage` interface in `packages/core/src/evaluation/providers/types.ts`
- [ ] 1.3 Add `maxDurationMs?: number` to `ToolTrajectoryExpectedItem` in `packages/core/src/evaluation/trace.ts`

## 2. Wire Format Parsing

- [ ] 2.1 Update JSONL parser to extract `duration_ms` from tool calls (snake_case → camelCase)
- [ ] 2.2 Update JSONL parser to extract `duration_ms` from output messages
- [ ] 2.3 Add tests for parsing timing data from JSONL

## 3. Tool Trajectory Evaluator

- [ ] 3.1 Extract latency assertions from expected items in `tool-trajectory.ts`
- [ ] 3.2 Implement latency check when matching tool calls (compare against `maxDurationMs`)
- [ ] 3.3 Add hits/misses for latency assertions (e.g., "Read completed in 45ms (max: 100ms)")
- [ ] 3.4 Handle missing `durationMs` gracefully (log warning, don't fail)
- [ ] 3.5 Add unit tests for latency assertion pass/fail cases
- [ ] 3.6 Add integration test with sample YAML eval file

## 4. Documentation

- [ ] 4.1 Update skill references with `max_duration_ms` example in expected_messages
- [ ] 4.2 Add example to `examples/features/` demonstrating latency assertions

## 5. Validation

- [ ] 5.1 Run `bun run build && bun run typecheck && bun run lint && bun test`
- [ ] 5.2 Validate proposal: `openspec validate add-latency-assertions --strict`
