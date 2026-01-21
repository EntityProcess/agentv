# Change: Add Input/Output Field Aliases and Shorthand

## Why

The current field names `input_messages` and `expected_messages` are verbose. Adding aliases and shorthand syntax improves developer experience without breaking changes.

## What Changes

- **Add alias** `input` for `input_messages` in YAML/JSONL
- **Add alias** `expected_output` for `expected_messages` in YAML/JSONL
- **Add shorthand** string syntax for single user query
- **Add shorthand** object syntax for structured output

No changes to internal types or code judge payload.

## Schema

```yaml
# New: Aliases with shorthand
input: "What is 2+2?"
expected_output:
  riskLevel: High

# Equivalent to existing syntax
input_messages:
  - role: user
    content: "What is 2+2?"
expected_messages:
  - role: assistant
    content:
      riskLevel: High

# Full message array still works with aliases
input:
  - role: system
    content: "You are a calculator"
  - role: user
    content: "What is 2+2?"

expected_output:
  - role: assistant
    tool_calls:
      - tool: Read
        input: { file_path: "config.json" }
  - role: assistant
    content: { riskLevel: High }
```

## Impact

- Affected specs: `yaml-schema`, `jsonl-dataset-format`
- Affected code:
  - `packages/core/src/evaluation/yaml-parser.ts`
  - `packages/core/src/evaluation/loaders/jsonl-parser.ts`
- No changes to:
  - Internal types (`EvalCase`)
  - Code judge payload
  - Existing examples (still work)

## Backward Compatibility

Fully backward compatible. Existing `input_messages` and `expected_messages` continue to work unchanged.
