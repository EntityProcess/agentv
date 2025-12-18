---
"@agentv/core": minor
"agentv": minor
---

- **Trace Events**: New `TraceEvent` and `TraceSummary` types for capturing normalized, provider-agnostic agent execution traces
- **Tool Trajectory Evaluator**: New `tool_trajectory` evaluator type with three matching modes:
- `any_order`: Validates minimum tool call counts regardless of order
- `in_order`: Validates tools appear in expected sequence (allows gaps)
- `exact`: Validates exact tool sequence match
- **Expected Messages Tool Calls**: Support for `tool_calls` field in `expected_messages` for validating assistant tool usage
- **CLI Flags**: `--dump-traces` and `--include-trace` flags for trace output control
- **Trace Summary**: Automatic computation of lightweight trace summaries (event count, tool names, call counts, error count) included in evaluation results