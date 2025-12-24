---
"@agentv/core": minor
"agentv": minor
---

Support expected_messages with tool_calls for trace evaluation

- Updated `isTestMessage` validation to accept messages with `tool_calls` array (without requiring `content`)
- Updated `processExpectedMessages` to preserve `tool_calls` and `name` fields from expected messages
- Updated `reference_answer` logic to include full expected_messages array as JSON when multiple messages are present
- Updated LLM judge prompt to understand reference_answer may contain a sequence of expected agent messages including tool calls
