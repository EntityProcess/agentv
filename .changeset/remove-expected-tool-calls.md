---
"@agentv/core": minor
"agentv": minor
---

Remove `expected_tool_calls` evaluator and add trace data to code evaluators

### Breaking Changes
- Removed `expected_tool_calls` evaluator type - use `tool_trajectory` evaluator instead
- Removed `tool_calls` field from `expected_messages` in eval YAML files
- Removed `TestMessageToolCall` type and `ExpectedToolCallsEvaluatorConfig` type

### New Features
- Code evaluators (`code_judge`) now receive trace data in their input payload:
  - `candidate_trace_file`: File path to trace JSON (if provider returned `traceRef`)
  - `candidate_trace_summary`: Lightweight summary with tool call counts and names

### Improvements
- Renamed `expected_segments` to `expected_messages` in `EvalCase` interface for better DX consistency with `input_messages`

### Migration
Users with `expected_tool_calls` configurations should:
1. Switch to `tool_trajectory` evaluator with explicit expected sequence
2. Or write a custom code evaluator that reads `candidate_trace` from input
