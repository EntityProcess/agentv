---
"@agentv/core": major
"agentv": major
---

Rename `expected_messages` evaluator type to `expected_tool_calls`

The evaluator type has been renamed from `expected_messages` to `expected_tool_calls` to better reflect its purpose of validating tool calls against traces.

Note: The `expected_messages` field in eval cases remains unchanged - only the evaluator type string changes.
