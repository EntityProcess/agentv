# Change: Add Per-Step Latency Assertions

## Why

The current `latency` evaluator only checks total execution time (`trace_summary.durationMs`). Users need to validate timing budgets on individual tool calls and messages to catch performance regressions at a granular level.

## What Changes

- **Add** `duration_ms` field to `OutputMessage` and `ToolCall` in output format
- **Add** `max_duration_ms` assertion field to `expected_messages` tool calls
- **Extend** `tool_trajectory` evaluator to validate per-step latency assertions

## Schema

### Output messages with timing data
```json
{
  "output_messages": [
    {
      "role": "assistant",
      "duration_ms": 1659,
      "tool_calls": [
        {
          "tool": "Read",
          "input": {"file_path": "config.json"},
          "output": "...",
          "duration_ms": 45
        },
        {
          "tool": "Edit",
          "input": {...},
          "output": "...",
          "duration_ms": 120
        }
      ]
    }
  ]
}
```

### Expected messages with latency assertions
```yaml
expected_messages:
  - role: assistant
    tool_calls:
      - tool: Read
        max_duration_ms: 100  # Must complete within 100ms
      - tool: Edit
        max_duration_ms: 500
```

## Backward Compatibility

Fully backward compatible:
- Existing evals without latency assertions continue working unchanged
- `duration_ms` fields are optional in output format
- Latency checks only run when assertions are specified in expected_messages
- Existing `latency` evaluator for total duration remains unchanged

## Impact

- Affected specs: `evaluation`
- Affected code:
  - `packages/core/src/evaluation/providers/types.ts` - Add `durationMs` to OutputMessage/ToolCall
  - `packages/core/src/evaluation/trace.ts` - Update ToolTrajectoryExpectedItem
  - `packages/core/src/evaluation/evaluators/tool-trajectory.ts` - Add latency validation
  - `packages/core/src/evaluation/loaders/` - Parse duration_ms from JSONL
