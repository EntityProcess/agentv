---
"@agentv/core": patch
---

Fix composite evaluators to pass through trace and output message context so trace-dependent evaluators (e.g. latency/cost/tool_trajectory) work when nested.
