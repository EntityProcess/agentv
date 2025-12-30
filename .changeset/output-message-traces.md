---
"@agentv/core": minor
"agentv": minor
---

Unify on OutputMessage format for agent execution traces

- Add `OutputMessage` and `ToolCall` types as the primary format for capturing agent execution
- Deprecate `TraceEvent` type in favor of the new `OutputMessage` format
- Remove `text` and `trace` fields from `ProviderResponse`, replaced by `outputMessages`
- Update template variables (`candidate_answer`, `reference_answer`) to extract content from output messages
- Tool trajectory evaluator now works with `OutputMessage` format for tool call validation
