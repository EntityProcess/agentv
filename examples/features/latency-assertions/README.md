# Tool Sequence Assertions

This example demonstrates Promptfoo-compatible `trajectory:*` assertions for tool sequence and argument checks.

## Overview

Authored YAML no longer supports AgentV's old per-tool `max_duration_ms` checks under `tool-trajectory`. Use `trajectory:tool-sequence` and `trajectory:tool-args-match` for tool behavior, and use a `script` assertion if an eval needs custom latency budgets.

## Usage

Use `trajectory:tool-sequence` for ordered calls and `trajectory:tool-args-match` for arguments:

```yaml
assert:
  - metric: tool-flow
    type: trajectory:tool-sequence
    value:
      mode: in_order
      steps: [Read, Edit]
  - type: trajectory:tool-args-match
    value:
      name: Read
      args:
        path: config.json
      mode: partial
```

## Scoring

Trajectory assertions score deterministic tool behavior:

- **Pass**: the expected tool behavior is present
- **Fail**: the expected sequence or arguments are missing
- **Skip**: no compatible tool calls are available in the output

## Provider Requirements

For trajectory assertions to work, providers must include tool calls:

```json
{
  "output": [{
    "role": "assistant",
    "tool_calls": [{
      "tool": "Read",
      "input": {"file_path": "config.json"},
      "duration_ms": 45
    }]
  }]
}
```

## Running the Example

```bash
# Validate YAML parsing
npx agentv validate examples/features/latency-assertions/evals/suite.yaml

# With the included mock provider or a real provider that returns tool calls
npx agentv eval examples/features/latency-assertions/evals/suite.yaml --provider mock_latency_agent
```

## Best Practices

1. **Assert stable behavior**: Prefer durable tool order and argument checks.
2. **Use scripts for latency**: Keep custom timing policy in a script assertion.
3. **Test with representative data**: Tool behavior can vary based on input size.
