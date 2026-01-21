# Design: Input/Output Field Aliases and Shorthand

## Context

AgentV uses `input_messages` and `expected_messages` for eval case definitions. These names are accurate but verbose. Rather than renaming (which would break code judges), we add aliases and shorthand syntax.

## Decision

Add parser-level aliases and shorthand expansion:

| Canonical Name | Alias | Shorthand |
|----------------|-------|-----------|
| `input_messages` | `input` | String → single user message |
| `expected_messages` | `expected_output` | Object → single assistant message |

Internal types and code judge payload unchanged.

## Alias Resolution

```typescript
// Parser logic
const inputMessages = raw.input_messages ?? expandShorthand(raw.input);
const expectedMessages = raw.expected_messages ?? expandShorthand(raw.expected_output);
```

Canonical name takes precedence if both specified.

## Shorthand Expansion

### `input` shorthand

```yaml
# String input
input: "What is 2+2?"

# Expands to
input_messages:
  - role: user
    content: "What is 2+2?"
```

### `expected_output` shorthand

```yaml
# String
expected_output: "The answer is 4"

# Expands to
expected_messages:
  - role: assistant
    content: "The answer is 4"

# Object (structured output)
expected_output:
  riskLevel: High

# Expands to
expected_messages:
  - role: assistant
    content:
      riskLevel: High
```

### Detection logic

For `expected_output`, detect format by checking for `role` key:

```typescript
function expandExpectedOutput(value: unknown): Message[] {
  if (typeof value === 'string') {
    return [{ role: 'assistant', content: value }];
  }
  if (Array.isArray(value) && value[0]?.role) {
    return value; // Already message array
  }
  if (typeof value === 'object' && !value.role) {
    return [{ role: 'assistant', content: value }]; // Structured object
  }
  return value;
}
```

## What Stays The Same

- `EvalCase` type uses `input_messages` and `expected_messages`
- Code judge payload uses `input_messages`, `expected_messages`, `candidate_answer`
- All existing eval files work unchanged
- Internal processing unchanged
