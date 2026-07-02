# External Datasets Example

Demonstrates loading raw test cases from external files using `imports.tests`.

## What This Shows

- Loading tests from external YAML files (`imports.tests[].path: cases/accuracy.yaml`)
- Loading tests from external JSONL files (`imports.tests[].path: cases/regression.jsonl`)
- Loading tests from promptfoo-compatible CSV files (`imports.tests[].path: cases/magic.csv`)
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
- `evals/cases/magic.csv` — CSV test data with promptfoo-style magic columns

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

### CSV (.csv)
CSV files use ordinary columns for `id`, `input`, and `vars`, plus promptfoo-style magic columns for assertions and metadata:

```csv
id,input,__expected,__provider_output,__metric,__threshold,__metadata:source,locale
csv-test,Reply with a greeting,icontains:hello,Hello there,greeting,0.8,csv,en-US
```

`__expected` and `__expectedN` become AgentV assertions for the supported CSV
mini-DSL. `latency(<ms>)`, `cost(<usd>)`, and `file://*.py` map to runnable
AgentV graders, with CSV file paths resolved relative to the CSV file;
unsupported promptfoo forms such as `similar:*` are rejected during validation.
`__provider_output` becomes AgentV `expected_output`; ordinary non-magic
columns such as `locale` become `vars` and can be interpolated by suite-level
`input`.

## Glob Patterns

Use glob patterns to load from multiple files:
```yaml
imports:
  tests:
    - path: cases/**/*.yaml    # All YAML files recursively
    - path: cases/*.jsonl      # All JSONL files in cases/
```
