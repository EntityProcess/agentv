# Per-Step Latency Assertions

This example demonstrates how to use the `max_duration_ms` field in `tool_trajectory` evaluators to validate per-tool-call timing budgets.

## Overview

The `tool_trajectory` evaluator now supports optional latency assertions on individual tool calls. This allows you to catch performance regressions at a granular level rather than only checking total execution time.

## Usage

Add `max_duration_ms` to any expected tool item:

```yaml
evaluators:
  - name: perf-check
    type: tool_trajectory
    mode: in_order
    expected:
      - tool: Read
        max_duration_ms: 100  # Must complete within 100ms
      - tool: Edit
        max_duration_ms: 500
```

## Scoring

Each latency assertion contributes to the trajectory score:

- **Pass**: `actual_duration <= max_duration_ms` → adds to hits
- **Fail**: `actual_duration > max_duration_ms` → adds to misses
- **Skip**: No `duration_ms` in output → logs warning, neutral (neither hit nor miss)

## Provider Requirements

For latency assertions to work, providers must include `duration_ms` in tool calls:

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
# Dry-run to validate YAML parsing
npx agentv eval examples/features/latency-assertions/evals/dataset.eval.yaml --dry-run

# With a real provider that returns duration_ms in tool calls
npx agentv eval examples/features/latency-assertions/evals/dataset.eval.yaml --target <your-target>
```

## Best Practices

1. **Set generous thresholds**: Allow for normal timing variance; tight budgets lead to flaky tests
2. **Focus on critical paths**: Only add latency assertions where timing matters
3. **Use alongside sequence checks**: Latency assertions complement tool sequence validation
4. **Test with representative data**: Timing can vary based on input size
