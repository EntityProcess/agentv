# External Datasets Example

Demonstrates loading raw test cases from external files using field-local `tests` file refs.

## What This Shows

- Loading tests from external YAML files (`tests: [file://cases/accuracy.yaml]`)
- Loading tests from external JSONL files (`tests: [file://cases/regression.jsonl]`)
- Loading tests from promptfoo-compatible CSV files (`tests: [file://cases/magic.csv]`)
- Mixing inline `tests` with external raw test rows
- Glob patterns for loading multiple files (`tests: [file://cases/**/*.yaml]`)

## Running

```bash
# From repository root
bun agentv eval examples/features/external-datasets/evals/suite.yaml
```

## Key Files

- `evals/suite.yaml` — Main eval with inline tests and `tests` file references
- `evals/cases/accuracy.yaml` — YAML array of test cases
- `evals/cases/regression.jsonl` — JSONL test data (one test per line)
- `evals/cases/magic.csv` — CSV test data with promptfoo-style magic columns

## Supported Formats

### YAML (.yaml, .yml)
External YAML files must contain an array of test objects:
```yaml
- id: test-1
  assert:
    - "Expected outcome"
  input: "User input"
- id: test-2
  assert:
    - "Another outcome"
  input: "Another input"
```

### JSONL (.jsonl)
One JSON test object per line:
```jsonl
{"id": "test-1", "assert": ["Expected outcome"], "input": "User input"}
{"id": "test-2", "assert": ["Another outcome"], "input": "Another input"}
```

### CSV (.csv)
CSV files use ordinary columns for `id`, `input`, and `vars`, plus promptfoo-style magic columns for assertions and metadata:

```csv
id,input,__expected,__metric,__threshold,__metadata:source,locale
csv-test,Reply with a greeting,icontains:hello,greeting,0.8,csv,en-US
```

`__expected` and `__expectedN` become AgentV assertions for the supported CSV
mini-DSL. `latency(<ms>)`, `cost(<usd>)`, and `file://*.py` map to runnable
AgentV graders, with CSV file paths resolved relative to the CSV file;
unsupported promptfoo forms such as `similar:*` are rejected during validation.
Use an explicit deterministic target such as `provider: cli` for fixed outputs,
or a replay/fixture target for captured provider responses. Ordinary non-magic
columns such as `locale` become `vars` and can be interpolated by suite-level
`input`.

## Glob Patterns

Use glob patterns to load from multiple files:
```yaml
tests:
  - file://cases/**/*.yaml    # All YAML files recursively
  - file://cases/*.jsonl      # All JSONL files in cases/
```
