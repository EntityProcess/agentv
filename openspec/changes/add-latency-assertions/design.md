# Design: Per-Step Latency Assertions

## Context

AgentV evaluates AI agent execution traces. The current `latency` evaluator only validates total execution time. Real-world traces (like ComplianceWise) include per-step timing:

```json
{
  "Type": "Llm",
  "StartTime": "2026-01-14T09:04:58.8268438+11:00",
  "Duration": "00:00:01.6590020",
  "ToolName": "",
  "Result": {...}
}
```

Users need to validate that individual tool calls complete within timing budgets.

## Goals

- Enable per-tool-call latency assertions in `expected_messages`
- Capture timing data in `output_messages` format
- Integrate with existing `tool_trajectory` evaluator (don't create new evaluator type)
- Maintain backward compatibility

## Non-Goals

- Span-based timing with start/end timestamps (future enhancement)
- Aggregate latency metrics (p50, p99) - use code_judge for complex analysis
- Real-time latency monitoring (AgentV is for offline evaluation)

## Decisions

### Decision 1: Extend tool_trajectory evaluator

**Rationale**: Latency assertions on tool calls are naturally part of trajectory validation. Creating a separate evaluator would fragment the user experience and require duplicate configuration.

**Alternative considered**: New `latency_trajectory` evaluator type
- Rejected: Would require users to configure both `tool_trajectory` for call sequence and `latency_trajectory` for timing, leading to duplication

### Decision 2: Use milliseconds as integer

**Rationale**: Matches existing `durationMs` convention in TraceSummary. Integer precision is sufficient for evaluation purposes (sub-ms precision adds noise).

**Alternative considered**: TimeSpan format ("00:00:01.6590020")
- Rejected: More complex to parse, less ergonomic for assertions

### Decision 3: Timing at tool call level, not message level

**Rationale**: Tool calls are the actionable unit for optimization. Message-level timing includes LLM thinking time which is less controllable.

**Alternative considered**: Message-level `max_duration_ms`
- Deferred: Can add later if use cases emerge

### Decision 4: Use existing timestamp + new duration_ms

**Rationale**: `ToolCall` already has `timestamp?: string`. Adding `durationMs` provides complete timing info without redundancy. This matches the real-world trace format (ComplianceWise uses `StartTime` + `Duration`).

**Wire format**:
```json
{
  "tool_calls": [{
    "tool": "Read",
    "timestamp": "2026-01-14T09:04:58.826Z",  // when it started (existing field)
    "duration_ms": 45                          // how long it took (new field)
  }]
}
```

End time is derivable (`timestamp + duration_ms`) and not stored separately to avoid redundancy.

## Scoring

Each latency assertion contributes to the trajectory score:

1. **Pass**: `actual_duration <= max_duration_ms` → adds to hits
2. **Fail**: `actual_duration > max_duration_ms` → adds to misses
3. **Skip**: No `duration_ms` in output → logs warning, neutral (neither hit nor miss)

Latency assertions are weighted equally with tool sequence assertions in the overall trajectory score.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Provider doesn't report timing | Skip assertion with warning; don't fail |
| Flaky tests due to timing variance | Users should set generous thresholds; document best practices |
| Conflating trajectory and latency concerns | Keep latency fields optional; users can ignore if not needed |

## Migration Plan

No migration needed - purely additive change.

## Open Questions

None - design is ready for implementation.
