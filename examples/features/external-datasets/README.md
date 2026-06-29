# External Datasets Example

Demonstrates loading raw test cases from external files using `imports.tests`.

## What This Shows

- Loading tests from external YAML files (`imports.tests[].path: cases/accuracy.yaml`)
- Loading tests from external JSONL files (`imports.tests[].path: cases/regression.jsonl`)
- Mixing inline `tests` with imported raw test rows
- Glob patterns for loading multiple files (`imports.tests[].path: cases/**/*.yaml`)

## Running

```bash
# From repository root
bun agentv eval examples/features/external-datasets/evals/dataset.eval.yaml
```

## Key Files

- `evals/dataset.eval.yaml` — Main eval with inline tests and `imports.tests` references
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
imports:
  tests:
    - path: cases/**/*.yaml    # All YAML files recursively
    - path: cases/*.jsonl      # All JSONL files in cases/
```
