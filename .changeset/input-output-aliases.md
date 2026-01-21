---
"@agentv/core": minor
"agentv": minor
---

feat: add input/expected_output field aliases with shorthand syntax

- `input` alias for `input_messages` (string shorthand expands to single user message)
- `expected_output` alias for `expected_messages` (string/object shorthand expands to single assistant message)
- Canonical names take precedence when both specified
- Full backward compatibility maintained
