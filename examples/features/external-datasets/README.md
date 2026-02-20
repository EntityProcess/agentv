# External Datasets Example

Demonstrates loading test cases from external files using `file://` references.

## What This Shows

- Loading tests from external YAML files (`file://cases/accuracy.yaml`)
- Loading tests from external JSONL files (`file://cases/regression.jsonl`)
- Mixing inline test definitions with external file references
- Glob patterns for loading multiple files (`file://cases/**/*.yaml`)

## Running

```bash
# From repository root
bun agentv eval examples/features/external-datasets/evals/dataset.yaml
```

## Key Files

- `evals/dataset.yaml` — Main eval with inline tests and `file://` references
- `evals/cases/accuracy.yaml` — YAML array of test cases
- `evals/cases/regression.jsonl` — JSONL test data (one test per line)

## Supported Formats

### YAML (.yaml, .yml)
External YAML files must contain an array of test objects:
```yaml
- id: test-1
  criteria: "Expected outcome"
  input: "User input"
- id: test-2
  criteria: "Another outcome"
  input: "Another input"
```

### JSONL (.jsonl)
One JSON test object per line:
```jsonl
{"id": "test-1", "criteria": "Expected outcome", "input": "User input"}
{"id": "test-2", "criteria": "Another outcome", "input": "Another input"}
```

## Glob Patterns

Use glob patterns to load from multiple files:
```yaml
tests:
  - file://cases/**/*.yaml    # All YAML files recursively
  - file://cases/*.jsonl      # All JSONL files in cases/
```
