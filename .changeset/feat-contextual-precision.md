---
"@agentv/core": minor
"@agentv/eval": minor
"agentv": minor
---

- Added a "Target Proxy" for `code_judge` evaluators, enabling custom code judges to make LLM calls through the configured evaluation provider without direct credential access.
- Unified framework message types into a single `Message` schema.
- Added `TargetClient` to `@agentv/eval` SDK for easy target invocation in custom evaluators.
- Removed the deprecated `code_snippets` field from `EvalCase`.
