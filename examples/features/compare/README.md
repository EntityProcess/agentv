# Baseline vs Candidate Comparison

Demonstrates comparing evaluation results between baseline and candidate versions.

## What This Shows

- Baseline result storage
- Candidate evaluation
- Diff generation and comparison
- Regression detection

## Running

```bash
# From repository root
# First run creates baseline
bun agentv eval examples/features/compare/evals/dataset.yaml

# Subsequent runs compare against baseline
bun agentv eval examples/features/compare/evals/dataset.yaml --compare
```

## Key Files

- `evals/dataset.yaml` - Comparison test cases
- `evals/*.baseline.jsonl` - Stored baseline results
