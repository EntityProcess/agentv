# Change: Rename Input/Output Fields

## Why

The current field names `input_messages` and `expected_messages` are verbose and don't clearly convey their purpose:
- `input_messages` → what goes into the agent
- `expected_messages` → what should come out

Simpler names improve developer experience and align with common terminology.

## What Changes

- **Rename** `input_messages` to `input` (with backward-compatible alias)
- **Rename** `expected_messages` to `expected_output` (with backward-compatible alias)
- **Update** code judge payload to use new field names
- **Update** all examples to use new field names

## Schema

```yaml
# Before
input_messages:
  - role: user
    content: "Query"
expected_messages:
  - role: assistant
    content: { riskLevel: High }

# After
input: "Query"  # String shorthand supported
expected_output:
  riskLevel: High  # Object shorthand for simple cases

# Full trace still supported
expected_output:
  - role: assistant
    tool_calls:
      - tool: Read
        input: { file_path: "config.json" }
  - role: assistant
    content: { riskLevel: High }
```

## Impact

- Affected specs: `yaml-schema`, `jsonl-dataset-format`, `evaluation`
- Affected code:
  - `packages/core/src/evaluation/types.ts`
  - `packages/core/src/evaluation/yaml-parser.ts`
  - `packages/core/src/evaluation/loaders/jsonl-parser.ts`
  - `packages/core/src/evaluation/evaluators/code-evaluator.ts`
  - All examples

## Backward Compatibility

Aliases ensure existing eval files continue to work:
- `input_messages` → `input`
- `expected_messages` → `expected_output`

Deprecation warnings logged when old names used.
