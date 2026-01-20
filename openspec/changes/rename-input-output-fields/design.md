# Design: Rename Input/Output Fields

## Context

AgentV uses `input_messages` and `expected_messages` for eval case definitions. These names are verbose and the "messages" suffix is misleading since:
- `input` can be a simple string query
- `expected_output` can be a structured object, not just messages

## Decision

Rename fields for clarity:

| Old Name | New Name | Rationale |
|----------|----------|-----------|
| `input_messages` | `input` | Shorter, clearer |
| `expected_messages` | `expected_output` | Describes what it is - the expected output |

## Field Formats

### `input`

```yaml
# String shorthand (common case)
input: "What is 2+2?"

# Full message array
input:
  - role: system
    content: "You are a calculator"
  - role: user
    content: "What is 2+2?"

# With file references
input:
  - role: user
    content:
      - type: file
        value: ./prompt.md
      - type: text
        value: "Process this"
```

### `expected_output`

```yaml
# String shorthand
expected_output: "4"

# Structured object (export-screening style)
expected_output:
  riskLevel: High
  reasoning: "..."

# Full message array with tool calls
expected_output:
  - role: assistant
    tool_calls:
      - tool: webSearch
        input: { query: "..." }
        output: { results: [...] }
  - role: assistant
    content:
      recommendation: "Highly Recommended"

# File reference
expected_output:
  - role: assistant
    content:
      type: file
      value: ./expected-answer.json
```

## Code Judge Payload

Update field names in code judge stdin payload:

```json
{
  "question": "...",
  "expected_outcome": "Goal description",
  "expected_output": [...],
  "input": [...],
  "actual_output": "...",
  "output_messages": [...],
  "trace_summary": {...}
}
```

| Old Field | New Field |
|-----------|-----------|
| `input_messages` | `input` |
| `expected_messages` | `expected_output` |
| `candidate_answer` | `actual_output` |

## Backward Compatibility

Parser accepts both old and new names:

```typescript
const input = raw.input ?? raw.input_messages;
const expectedOutput = raw.expected_output ?? raw.expected_messages;

if (raw.input_messages) {
  logger.warn("'input_messages' is deprecated, use 'input'");
}
```

New name takes precedence if both specified.
