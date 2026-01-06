# Baseline vs Candidate Comparison

Demonstrates comparing evaluation results between baseline and candidate versions using the `agentv compare` command.

## What This Shows

- Comparing two evaluation result files
- Score delta calculation and win/loss classification
- Regression detection via exit codes
- Human-readable and JSON output formats

## Running

```bash
# From repository root
# Compare baseline vs candidate results
bun agentv compare examples/features/compare/evals/baseline-results.jsonl examples/features/compare/evals/candidate-results.jsonl

# With custom threshold for win/loss classification
bun agentv compare examples/features/compare/evals/baseline-results.jsonl examples/features/compare/evals/candidate-results.jsonl --threshold 0.05

# JSON output for CI pipelines
bun agentv compare examples/features/compare/evals/baseline-results.jsonl examples/features/compare/evals/candidate-results.jsonl --json
```

## Key Files

- `evals/baseline-results.jsonl` - Results from baseline configuration
- `evals/candidate-results.jsonl` - Results from candidate configuration
- `evals/README.md` - Detailed usage documentation
